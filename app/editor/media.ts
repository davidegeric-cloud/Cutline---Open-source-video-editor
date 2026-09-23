import {
  animatedItem,
  clamp,
  dimensions,
  endOf,
  projectDuration,
  trackKey,
  transitionWindow,
  uid,
  type Asset,
  type Project,
} from "./model";
import { Renderer, type MediaSources } from "./renderer";

function ready(element: HTMLMediaElement, event: string, timeout = 20000) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener(event, done);
      element.removeEventListener("error", fail);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(
        new Error(
          "This media could not be decoded. Try H.264 MP4, WebM, MP3, WAV, or a standard image.",
        ),
      );
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Media took too long to load. The file may be damaged or unsupported.",
        ),
      );
    }, timeout);
    element.addEventListener(event, done, { once: true });
    element.addEventListener("error", fail, { once: true });
  });
}
export async function inspectFile(file: File): Promise<Asset> {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const kind =
    file.type.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp", "gif", "avif"].includes(extension)
      ? "image"
      : file.type.startsWith("audio/") ||
          ["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(extension)
        ? "audio"
        : "video";
  const url = URL.createObjectURL(file);
  const asset: Asset = {
    id: uid("asset"),
    name: file.name,
    kind,
    url,
    duration: 5,
    sizeLabel:
      file.size < 1024 * 1024
        ? Math.ceil(file.size / 1024) + " KB"
        : (file.size / 1024 / 1024).toFixed(1) + " MB",
    theme: kind,
  };
  try {
    if (kind === "image") {
      const img = new Image();
      img.src = url;
      await img.decode();
      asset.width = img.naturalWidth;
      asset.height = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = Math.round((240 * img.naturalHeight) / img.naturalWidth);
      canvas
        .getContext("2d")!
        .drawImage(img, 0, 0, canvas.width, canvas.height);
      asset.thumbnail = canvas.toDataURL("image/jpeg", 0.7);
    } else {
      const element = document.createElement(
        kind === "audio" ? "audio" : "video",
      );
      element.preload = "auto";
      element.muted = true;
      const loaded = ready(element, "loadeddata");
      element.src = url;
      await loaded;
      if (!Number.isFinite(element.duration) || element.duration <= 0)
        throw new Error(
          "This file has no readable duration. Re-encode it and try again.",
        );
      asset.duration = element.duration;
      if (element instanceof HTMLVideoElement) {
        asset.width = element.videoWidth;
        asset.height = element.videoHeight;
        if (!asset.width || !asset.height)
          throw new Error("No supported video track was found in this file.");
        const canvas = document.createElement("canvas");
        canvas.width = 240;
        canvas.height = Math.max(
          1,
          Math.round((240 * element.videoHeight) / element.videoWidth),
        );
        canvas
          .getContext("2d")!
          .drawImage(element, 0, 0, canvas.width, canvas.height);
        asset.thumbnail = canvas.toDataURL("image/jpeg", 0.7);
      }
      element.removeAttribute("src");
      element.load();
      if (kind === "audio" && file.size < 64 * 1024 * 1024) {
        const context = new AudioContext();
        try {
          const buffer = await context.decodeAudioData(
            await file.arrayBuffer(),
          );
          const data = buffer.getChannelData(0);
          const bins = 160,
            step = Math.max(1, Math.floor(data.length / bins));
          asset.waveform = Array.from({ length: bins }, (_, i) => {
            let max = 0;
            for (
              let j = i * step;
              j < Math.min(data.length, (i + 1) * step);
              j += 8
            )
              max = Math.max(max, Math.abs(data[j]));
            return max;
          });
        } catch {
          /* Waveform is optional; playable media is still usable. */
        } finally {
          await context.close();
        }
      }
    }
    return asset;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export class MediaPool {
  revision = 0;
  sources: MediaSources = new Map();
  private elements = new Map<string, HTMLMediaElement>();
  private pending = new Map<string, Promise<void>>();
  private urls = new Map<string, string>();
  private gains = new Map<string, GainNode>();
  private nodes = new Map<string, MediaElementAudioSourceNode>();
  context: AudioContext | null = null;
  destination: MediaStreamAudioDestinationNode | null = null;
  private disposed = false;
  async ensure(project: Project) {
    const ids = new Set(project.clips.map((c) => c.id));
    for (const id of this.urls.keys()) if (!ids.has(id)) this.remove(id);
    await Promise.all(
      project.clips.map((c) => {
        const asset = project.assets.find((a) => a.id === c.assetId);
        if (!asset?.url) return;
        if (this.urls.get(c.id) === asset.url) return this.pending.get(c.id);
        this.remove(c.id);
        this.urls.set(c.id, asset.url);
        const promise = (async () => {
          if (asset.kind === "image") {
            const img = new Image();
            img.src = asset.url!;
            await img.decode();
            if (!this.disposed && this.urls.get(c.id) === asset.url) {
              this.sources.set(c.id, img);
              this.revision++;
            }
          } else {
            const el = document.createElement(
              asset.kind === "audio" ? "audio" : "video",
            );
            el.preload = "auto";
            el.muted = true;
            if (el instanceof HTMLVideoElement) el.playsInline = true;
            this.elements.set(c.id, el);
            el.addEventListener("seeked", () => {
              this.revision++;
            });
            const loaded = ready(el, "loadeddata");
            el.src = asset.url!;
            await loaded;
            if (this.disposed) return;
            if (el instanceof HTMLVideoElement) this.sources.set(c.id, el);
            this.revision++;
            this.connect(c.id, el);
          }
        })();
        this.pending.set(c.id, promise);
        return promise;
      }),
    );
  }
  private connect(id: string, el: HTMLMediaElement) {
    if (!this.context || this.nodes.has(id)) return;
    const node = this.context.createMediaElementSource(el),
      gain = this.context.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    gain.connect(this.destination ?? this.context.destination);
    this.nodes.set(id, node);
    this.gains.set(id, gain);
    el.muted = false;
  }
  async enableAudio(exporting = false) {
    if (!this.context) {
      this.context = new AudioContext();
      if (exporting)
        this.destination = this.context.createMediaStreamDestination();
      for (const [id, el] of this.elements) this.connect(id, el);
    }
    if (this.context.state === "suspended") await this.context.resume();
  }
  sync(project: Project, time: number, playing: boolean) {
    const seeks: Promise<void>[] = [];
    const joins = project.clips.flatMap((incoming) => {
      if (incoming.kind !== "video") return [];
      const window = transitionWindow(project, incoming);
      return window && time >= window.start && time < window.end ? [{ incoming, window }] : [];
    });
    for (const c of project.clips) {
      const el = this.elements.get(c.id);
      if (!el) continue;
      const asset = project.assets.find((a) => a.id === c.assetId);
      const visibleOnTrack =
        c.kind === "video"
          ? project.clips
              .filter(
                (other) =>
                  other.kind === "video" &&
                  other.track === c.track &&
                  time >= other.start &&
                  time < endOf(other),
              )
              .sort((a, b) => a.start - b.start)
              .at(-1)
          : null;
      const active =
        c.kind === "video"
          ? visibleOnTrack?.id === c.id
          : time >= c.start && time < endOf(c);
      const incomingWindow = joins.find((join) => join.incoming.id === c.id)?.window;
      const incomingMix = incomingWindow
        ? clamp((time - incomingWindow.start) / incomingWindow.duration, 0, 1) : null;
      const outgoingWindow = joins.find((join) => join.window.previous.id === c.id)?.window;
      const outgoingMix = outgoingWindow
        ? clamp((time - outgoingWindow.start) / outgoingWindow.duration, 0, 1) : null;
      const inTransition = incomingMix !== null || outgoingMix !== null;
      if (!active && !inTransition) {
        el.pause();
        const gain = this.gains.get(c.id);
        if (gain) gain.gain.value = 0;
        continue;
      }
      const sourceTime = clamp(
        c.frozenAt ?? (c.sourceStart + (time - c.start) * c.speed),
        0,
        Math.max(0, (asset?.duration ?? el.duration) - 0.002),
      );
      el.playbackRate = c.speed;
      if (
        Math.abs(el.currentTime - sourceTime) > (playing ? 0.18 : 0.008) &&
        !el.seeking
      ) {
        const seek = ready(el, "seeked", 10000);
        el.currentTime = sourceTime;
        seeks.push(seek);
      }
      const animated = animatedItem(c, time);
      const audioStart = incomingMix !== null ? incomingWindow!.start : c.start;
      const audioEnd = outgoingMix !== null ? outgoingWindow!.end : endOf(c);
      const fade = Math.min(
        animated.fadeIn > 0 ? clamp((time - audioStart) / animated.fadeIn, 0, 1) : 1,
        animated.fadeOut > 0 ? clamp((audioEnd - time) / animated.fadeOut, 0, 1) : 1,
      );
      const transitionGain = incomingMix !== null ? incomingMix : outgoingMix !== null ? 1 - outgoingMix : 1;
      const gain = this.gains.get(c.id);
      if (gain)
        gain.gain.value =
          (active || inTransition) && c.frozenAt === undefined &&
          !project.mutedTracks.includes(trackKey(c)) &&
          !project.hiddenTracks.includes(trackKey(c))
            ? animated.volume * fade * transitionGain
            : 0;
      if (playing && (active || inTransition) && c.frozenAt === undefined && el.paused)
        void el.play().catch(() => {
          /* Subsequent user playback can resume a blocked media element. */
        });
      if (!playing || (!active && !inTransition) || c.frozenAt !== undefined) el.pause();
    }
    return Promise.all(seeks);
  }
  pause() {
    for (const el of this.elements.values()) el.pause();
  }
  private remove(id: string) {
    const el = this.elements.get(id);
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    this.nodes.get(id)?.disconnect();
    this.gains.get(id)?.disconnect();
    this.nodes.delete(id);
    this.gains.delete(id);
    this.elements.delete(id);
    this.sources.delete(id);
    this.revision++;
    this.urls.delete(id);
    this.pending.delete(id);
  }
  dispose() {
    this.disposed = true;
    for (const id of [...this.urls.keys()]) this.remove(id);
    if (this.context) void this.context.close();
  }
}

export const exportFormats = () =>
  [
    {
      label: "MP4 · H.264",
      extension: "mp4",
      mime: "video/mp4;codecs=avc1.42001f,mp4a.40.2",
    },
    {
      label: "WebM · VP9",
      extension: "webm",
      mime: "video/webm;codecs=vp9,opus",
    },
    {
      label: "WebM · VP8",
      extension: "webm",
      mime: "video/webm;codecs=vp8,opus",
    },
  ].filter(
    (f) =>
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(f.mime),
  );

export async function exportProject(
  project: Project,
  options: {
    resolution: number;
    fps: number;
    mime: string;
    signal: AbortSignal;
    onProgress: (progress: number, phase: string) => void;
  },
) {
  const { signal, onProgress } = options;
  const check = () => {
    if (signal.aborted)
      throw new DOMException("Export cancelled", "AbortError");
  };
  const duration = projectDuration(project);
  const missing = project.clips
    .map((c) => project.assets.find((a) => a.id === c.assetId))
    .find((a) => !a || (a.kind !== "demo" && !a.url));
  if (
    project.clips.some(
      (c) => !project.assets.some((a) => a.id === c.assetId),
    ) ||
    missing
  )
    throw new Error(
      "A clip’s source media is missing. Restore a project backup with its media before exporting.",
    );
  if (duration <= 0)
    throw new Error("Add a video, audio, or text clip before exporting.");
  const canvas = document.createElement("canvas");
  Object.assign(canvas, dimensions(project.ratio, options.resolution));
  const renderer = new Renderer(),
    pool = new MediaPool();
  let recorder: MediaRecorder | null = null,
    stream: MediaStream | null = null;
  let frame = 0;
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted)
      reject(new DOMException("Export cancelled", "AbortError"));
    else
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Export cancelled", "AbortError")),
        { once: true },
      );
  });
  // Handle cancellation even during loading, and keep all recorders and tracks scoped to this export.
  try {
    onProgress(0, "Preparing media");
    await Promise.race([pool.ensure(project), abortPromise]);
    check();
    await document.fonts.ready;
    await pool.enableAudio(true);
    await Promise.race([pool.sync(project, 0, false), abortPromise]);
    check();
    renderer.draw(canvas, project, 0, pool.sources);
    stream = canvas.captureStream(options.fps);
    for (const track of pool.destination?.stream.getAudioTracks() ?? [])
      stream.addTrack(track);
    recorder = new MediaRecorder(stream, {
      mimeType: options.mime,
      videoBitsPerSecond:
        options.resolution >= 2160
          ? 24000000
          : options.resolution >= 1080
            ? 10000000
            : 5000000,
      audioBitsPerSecond: 192000,
    });
    const chunks: Blob[] = [];
    const stopped = new Promise<void>((resolve, reject) => {
      recorder!.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder!.onstop = () => resolve();
      recorder!.onerror = () =>
        reject(new Error("The encoder failed. Try 720p or the WebM format."));
    });
    recorder.start(250);
    const started = performance.now();
    const render = new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (signal.aborted) {
          reject(new DOMException("Export cancelled", "AbortError"));
          return;
        }
        const elapsed = Math.min(
          duration,
          (performance.now() - started) / 1000,
        );
        void pool
          .sync(project, Math.min(elapsed, duration - 0.001), true)
          .catch(reject);
        renderer.draw(
          canvas,
          project,
          Math.min(elapsed, duration - 0.001),
          pool.sources,
        );
        onProgress(elapsed / duration, "Rendering your video");
        if (elapsed >= duration) resolve();
        else frame = requestAnimationFrame(tick);
      };
      tick();
    });
    await Promise.race([
      render,
      stopped.then(() => {
        throw new Error("The encoder stopped before the video was finished.");
      }),
      abortPromise,
    ]);
    pool.pause();
    recorder.stop();
    await stopped;
    check();
    const blob = new Blob(chunks, { type: options.mime });
    if (!blob.size)
      throw new Error(
        "The encoder produced an empty video. Try another format.",
      );
    onProgress(1, "Video ready");
    return blob;
  } finally {
    cancelAnimationFrame(frame);
    pool.dispose();
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
  }
}

export async function saveBlob(blob: Blob, name: string) {
  if (window.cutlineDesktop)
    return !(
      await window.cutlineDesktop.saveFile(name, await blob.arrayBuffer())
    ).canceled;
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}
