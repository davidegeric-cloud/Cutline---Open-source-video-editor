import { build } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";
await build({
  configFile: false,
  logLevel: "warn",
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    outDir: "work/engine-tests",
    emptyOutDir: true,
    lib: {
      entry: "tests/engine-entry.ts",
      formats: ["iife"],
      name: "CutlineEngineTests",
      fileName: () => "engine.js",
    },
  },
});
const child = spawn(electron, ["tests/engine-main.cjs"], {
  stdio: "inherit",
  windowsHide: true,
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
