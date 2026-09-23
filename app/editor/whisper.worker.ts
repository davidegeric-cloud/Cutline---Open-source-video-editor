import { pipeline, env } from "@huggingface/transformers";

env.useBrowserCache = true;
type Request = { audio: Float32Array; model: string };
type Chunk = { text: string; timestamp: [number, number | null] };
let transcriber: ((audio: Float32Array, options: Record<string, unknown>) => Promise<unknown>) | null = null;
let currentModel = "";
self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const { audio, model } = event.data;
    if (!transcriber || currentModel !== model) {
      self.postMessage({ type: "status", message: "Downloading Whisper model…" });
      transcriber = await pipeline("automatic-speech-recognition", model, {
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
    self.postMessage({ type: "error", message: (error as Error).message });
  }
};
