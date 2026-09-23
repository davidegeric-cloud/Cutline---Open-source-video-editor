const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  session,
} = require("electron");
const { writeFile } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ID = "com.cutline.editor";
let mainWindow = null;
let closeApproved = false;
let closing = false;
if (process.env.CUTLINE_TEST_PROFILE)
  app.setPath("userData", path.resolve(process.env.CUTLINE_TEST_PROFILE));

app.setAppUserModelId(APP_ID);

function isTrustedSender(event) {
  const senderUrl = event.senderFrame?.url ?? "";
  if (
    event.sender !== mainWindow?.webContents ||
    event.senderFrame !== event.sender.mainFrame
  )
    return false;
  if (process.env.CUTLINE_DEV_URL)
    return (
      new URL(senderUrl).origin === new URL(process.env.CUTLINE_DEV_URL).origin
    );
  return (
    senderUrl ===
    pathToFileURL(path.join(__dirname, "..", "dist-desktop", "index.html")).href
  );
}

function requireTrustedSender(event) {
  if (!isTrustedSender(event))
    throw new Error("Untrusted desktop request blocked.");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: "#080a0e",
    icon: path.join(__dirname, "..", "public", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (
      process.env.CUTLINE_SMOKE_TEST !== "1" &&
      process.env.CUTLINE_LAYOUT_TEST !== "1"
    ) mainWindow?.show();
  });
  mainWindow.on("maximize", () =>
    mainWindow?.webContents.send("window:maximized-change", true),
  );
  mainWindow.on("unmaximize", () =>
    mainWindow?.webContents.send("window:maximized-change", false),
  );
  mainWindow.on("enter-full-screen", () =>
    mainWindow?.webContents.send("window:fullscreen-change", true),
  );
  mainWindow.on("leave-full-screen", () =>
    mainWindow?.webContents.send("window:fullscreen-change", false),
  );
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("close", (event) => {
    if (closeApproved || process.env.CUTLINE_SMOKE_TEST === "1") return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    mainWindow.webContents.send("app:before-close");
    setTimeout(async () => {
      if (!closing || closeApproved || !mainWindow) return;
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        message: "Cutline is still saving your project.",
        detail: "Wait to keep your latest changes, or close without waiting.",
        buttons: ["Keep waiting", "Close anyway"],
        defaultId: 0,
        cancelId: 0,
      });
      closing = false;
      if (result.response === 1) {
        closeApproved = true;
        mainWindow?.close();
      }
    }, 5000);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = process.env.CUTLINE_DEV_URL
      ? new URL(url).origin === new URL(process.env.CUTLINE_DEV_URL).origin
      : url ===
        pathToFileURL(path.join(__dirname, "..", "dist-desktop", "index.html"))
          .href;
    if (!allowed) event.preventDefault();
  });

  if (process.env.CUTLINE_DEV_URL) {
    void mainWindow.loadURL(process.env.CUTLINE_DEV_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, "..", "dist-desktop", "index.html"),
    );
  }

  if (process.env.CUTLINE_SMOKE_TEST === "1") {
    mainWindow.webContents.once("did-finish-load", () => {
      process.stdout.write("CUTLINE_DESKTOP_READY\n");
      setTimeout(() => app.quit(), 250);
    });
    mainWindow.webContents.once(
      "did-fail-load",
      (_event, code, description) => {
        process.stderr.write(
          `CUTLINE_DESKTOP_LOAD_FAILED ${code} ${description}\n`,
        );
        process.exitCode = 1;
        app.quit();
      },
    );
  }
}

ipcMain.on("window:minimize", (event) => {
  if (isTrustedSender(event))
    BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("app:ready-close", async (event, error) => {
  if (!isTrustedSender(event) || !closing) return;
  if (error) {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      message: "Your latest changes could not be saved.",
      detail:
        String(error).slice(0, 500) +
        "\nKeep the app open to make a project backup.",
      buttons: ["Keep editing", "Close anyway"],
      defaultId: 0,
      cancelId: 0,
    });
    closing = false;
    if (result.response !== 1) return;
  }
  closeApproved = true;
  mainWindow?.close();
});

ipcMain.on("window:maximize", (event) => {
  if (!isTrustedSender(event)) return;
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});

ipcMain.on("window:fullscreen", (event) => {
  if (!isTrustedSender(event)) return;
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) window.setFullScreen(!window.isFullScreen());
});

ipcMain.handle("window:is-fullscreen", (event) => {
  requireTrustedSender(event);
  return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
});

ipcMain.on("window:close", (event) => {
  if (isTrustedSender(event))
    BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle("window:is-maximized", (event) => {
  requireTrustedSender(event);
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});

ipcMain.handle("app:version", (event) => {
  requireTrustedSender(event);
  return app.getVersion();
});

ipcMain.handle("project:confirm-new", async (event) => {
  requireTrustedSender(event);
  const window = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showMessageBox(window, {
    type: "question",
    title: "Start a new project?",
    message: "Start a new Cutline project?",
    detail:
      "Your current project and its imported media will remain in My projects on this device.",
    buttons: ["Cancel", "Start new project"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
});

ipcMain.handle("file:save", async (event, payload) => {
  requireTrustedSender(event);
  const window = BrowserWindow.fromWebContents(event.sender);
  const safeName = path.basename(
    String(payload?.suggestedName || "cutline-export.webm"),
  );
  const extension = path.extname(safeName).slice(1).toLowerCase();
  const fileTypes = {
    webm: "WebM video",
    mp4: "MP4 video",
    cutline: "Cutline project backup",
  };
  if (!fileTypes[extension]) throw new Error("Unsupported save format.");
  const result = await dialog.showSaveDialog(window, {
    title:
      extension === "cutline"
        ? "Save Cutline project backup"
        : "Export Cutline video",
    defaultPath: path.join(
      app.getPath(extension === "cutline" ? "documents" : "videos"),
      safeName,
    ),
    filters: [{ name: fileTypes[extension], extensions: [extension] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const bytes = payload?.bytes;
  if (!(bytes instanceof ArrayBuffer)) throw new Error("Invalid export data.");
  await writeFile(result.filePath, Buffer.from(bytes));
  return { canceled: false, filePath: result.filePath };
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
