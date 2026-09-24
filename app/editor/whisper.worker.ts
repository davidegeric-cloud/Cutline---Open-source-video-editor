import { pipeline, env } from "@huggingface/transformers";

env.useBrowserCache = true;
type Request = { audio: Float32Array; model: string; runtimeUrl: string };
type Chunk = { text: string; timestamp: [number, number | null] };
let transcriber: ((audio: Float32Array, options: Record<string, unknown>) => Promise<unknown>) | null = null;
let currentModel = "";
self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const { audio, model, runtimeUrl } = event.data;
    // Serve the matching ONNX runtime beside the app. A third-party CDN is not
    // required to start transcription, even on restricted networks.
    if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = runtimeUrl;
    if (!transcriber || currentModel !== model) {
      self.postMessage({ type: "status", message: "Downloading Whisper model…" });
      transcriber = await pipeline("automatic-speech-recognition", model, {
        // Keep Large practical for CPU inference by selecting the repository's
        // q8 ONNX weights (roughly 1.6 GB across encoder + merged decoder).
        ...(model === "Xenova/whisper-large-v3" ? { dtype: "q8" } : {}),
        progress_callback: (progress) => {
          if (progress.status === "progress") self.postMessage({ type: "progress", file: progress.file, progress: progress.progress });
          else if (progress.status === "ready") self.postMessage({ type: "status", message: "Whisper is ready." });
        },
      }) as unknown as typeof transcriber;
      currentModel = model;
    }
    self.postMessage({ type: "status", message: "Transcribing audio on this device…" });
    const result = await transcriber!(audio, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5 });
    const output = Array.isArray(result) ? result[0] : result;
    const chunks = (output as { chunks?: Chunk[]; text?: string }).chunks ?? [];
    self.postMessage({ type: "done", chunks, text: (output as { text?: string }).text ?? "" });
  } catch (error) {
    const message = (error as Error).message || "Transcription failed.";
    self.postMessage({
      type: "error",
      message: /failed to fetch|fetch failed|networkerror/i.test(message)
        ? "Could not download the Whisper speech model. Check your connection to huggingface.co, then retry. The download is only needed once."
        : message,
    });
  }
};
