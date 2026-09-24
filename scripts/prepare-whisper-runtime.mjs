import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "node_modules", "@huggingface", "transformers", "dist");
const target = path.join(root, "public", "whisper-runtime");
await mkdir(target, { recursive: true });
for (const name of ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
  await copyFile(path.join(source, name), path.join(target, name));
}
