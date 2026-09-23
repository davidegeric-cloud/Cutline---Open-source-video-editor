const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

process.env.CUTLINE_LAYOUT_TEST = "1";
process.env.CUTLINE_TEST_PROFILE = path.resolve("work/layout-test-profile");
require("../electron/main.cjs");

function waitFor(condition, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = async () => {
      try {
        const value = await condition();
        if (value) return resolve(value);
        if (Date.now() >= deadline) return reject(new Error("Layout check timed out"));
        setTimeout(check, 30);
      } catch (error) {
        reject(error);
      }
    };
    void check();
  });
}

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  try {
    await waitFor(() => win.webContents.executeJavaScript(
      '!!document.querySelector("[aria-label=\\"Full screen editor\\"]")',
    ));
    for (const [width, height] of [[1480, 920], [1100, 700]]) {
      win.setSize(width, height);
      const layout = await win.webContents.executeJavaScript(`(() => {
        const stage = document.querySelector(".preview-stage").getBoundingClientRect();
        const workspace = document.querySelector(".editing-workspace");
        const panel = document.querySelector(".preview-panel").getBoundingClientRect();
        const inspector = document.querySelector(".inspector").getBoundingClientRect();
        const canvas = document.querySelector(".canvas-wrap").getBoundingClientRect();
        const timeline = document.querySelector(".timeline").getBoundingClientRect();
        return { workspace: [workspace.getBoundingClientRect().width, workspace.scrollWidth,
            getComputedStyle(workspace).gridTemplateColumns], panel: [panel.width, panel.height],
          inspector: inspector.width, stage: [stage.width, stage.height],
          canvas: [canvas.width, canvas.height], timeline: timeline.height,
          viewport: [innerWidth, innerHeight], documentWidth: document.documentElement.scrollWidth };
      })()`);
      assert.ok(layout.canvas[0] > 0 && layout.canvas[1] > 0, "Preview vanished");
      assert.equal(layout.workspace[0], layout.viewport[0], "Workspace overflowed the window");
      assert.equal(layout.workspace[1], layout.viewport[0], "A panel caused horizontal overflow");
      assert.ok(layout.canvas[0] <= layout.stage[0] && layout.canvas[1] <= layout.stage[1],
        "Preview is clipped by its panel");
      assert.ok(layout.stage[1] > layout.timeline, "Timeline dominates the editor");
      process.stdout.write(JSON.stringify(layout) + "\n");
    }

    await win.webContents.executeJavaScript(
      'document.querySelector("[aria-label=\\"Full screen editor\\"]").click()',
    );
    await waitFor(() => win.isFullScreen());
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector("[aria-label=\\"Exit full screen editor\\"]") !== null',
    ), true);
    await win.webContents.executeJavaScript(
      'document.querySelector("[aria-label=\\"Exit full screen editor\\"]").click()',
    );
    await waitFor(() => !win.isFullScreen());
    await win.webContents.executeJavaScript(
      'window.dispatchEvent(new KeyboardEvent("keydown", { key: "F11", bubbles: true }))',
    );
    await waitFor(() => win.isFullScreen());
    await win.webContents.executeJavaScript(
      'window.dispatchEvent(new KeyboardEvent("keydown", { key: "F11", bubbles: true }))',
    );
    await waitFor(() => !win.isFullScreen());
    await win.webContents.executeJavaScript(
      'document.querySelector("[aria-label=\\"Fullscreen preview\\"]").click()',
    );
    await waitFor(() => win.isFullScreen());
    assert.equal(await win.webContents.executeJavaScript(
      'document.querySelector(".preview-stage").classList.contains("preview-immersive")',
    ), true);
    const previewBounds = await win.webContents.executeJavaScript(`(() => {
      const stage = document.querySelector(".preview-stage").getBoundingClientRect();
      const canvas = document.querySelector(".canvas-wrap").getBoundingClientRect();
      return { stage: [stage.width, stage.height], canvas: [canvas.width, canvas.height],
        viewport: [innerWidth, innerHeight] };
    })()`);
    assert.deepEqual(previewBounds.stage, previewBounds.viewport);
    assert.ok(previewBounds.canvas[0] <= previewBounds.stage[0]);
    assert.ok(previewBounds.canvas[1] <= previewBounds.stage[1]);
    await win.webContents.executeJavaScript(
      'document.querySelector("[aria-label=\\"Exit fullscreen preview\\"]").click()',
    );
    await waitFor(() => !win.isFullScreen());
    await waitFor(() => win.webContents.executeJavaScript(
      '!document.querySelector(".preview-stage").classList.contains("preview-immersive")',
    ));
    process.stdout.write("CUTLINE_LAYOUT_AND_FULLSCREEN_READY\n");
    app.exit(0);
  } catch (error) {
    process.stderr.write(String(error.stack ?? error) + "\n");
    app.exit(1);
  }
});
