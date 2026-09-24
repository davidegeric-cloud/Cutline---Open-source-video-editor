// Optional integration smoke: run with `electron tests/whisper-main.cjs`.
// It intentionally downloads the free Whisper Tiny model to a disposable test profile.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.setPath("userData", path.resolve("work/whisper-profile"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const timeout = setTimeout(() => { process.stderr.write("Whisper smoke timed out\n"); app.exit(1); }, 180000);
  try {
    const root = process.env.CUTLINE_PACKAGED_TEST === "1"
      ? path.resolve("outputs/desktop/win-unpacked/resources/app.asar/dist-desktop")
      : path.resolve("dist-desktop");
    await window.loadFile(path.join(root, "index.html"));
    const workerName = fs.readdirSync(path.join(root, "assets")).find((name) => /^whisper\.worker-.*\.js$/.test(name));
    if (!workerName) throw new Error("Whisper worker missing from desktop build");
    const result = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const worker = new Worker(new URL(${JSON.stringify(`./assets/${workerName}`)}, location.href), { type: "module" });
      worker.onmessage = (event) => {
        if (event.data.type === "status" || event.data.type === "progress") console.log("WHISPER", JSON.stringify(event.data));
        if (event.data.type === "done") { worker.terminate(); resolve(event.data); }
        if (event.data.type === "error") { worker.terminate(); reject(new Error(event.data.message)); }
      };
      worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || "Worker failed")); };
      worker.postMessage({ audio: new Float32Array(16000), model: "Xenova/whisper-tiny.en", runtimeUrl: new URL("./whisper-runtime/", document.baseURI).href });
    })`);
    process.stdout.write(`WHISPER_SMOKE_READY ${JSON.stringify(result)}\n`);
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    clearTimeout(timeout);
    app.exit(1);
  }
});
