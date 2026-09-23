const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cutlineDesktop", {
  isDesktop: true,
  platform: process.platform,
  version: () => ipcRenderer.invoke("app:version"),
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  toggleFullscreen: () => ipcRenderer.send("window:fullscreen"),
  isFullscreen: () => ipcRenderer.invoke("window:is-fullscreen"),
  onFullscreenChange: (callback) => {
    const listener = (_event, fullscreen) => callback(Boolean(fullscreen));
    ipcRenderer.on("window:fullscreen-change", listener);
    return () => ipcRenderer.removeListener("window:fullscreen-change", listener);
  },
  close: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizedChange: (callback) => {
    const listener = (_event, maximized) => callback(Boolean(maximized));
    ipcRenderer.on("window:maximized-change", listener);
    return () =>
      ipcRenderer.removeListener("window:maximized-change", listener);
  },
  saveFile: (suggestedName, bytes) =>
    ipcRenderer.invoke("file:save", { suggestedName, bytes }),
  confirmNewProject: () => ipcRenderer.invoke("project:confirm-new"),
  onBeforeClose: (callback) => {
    const listener = async () => {
      try {
        await callback();
        ipcRenderer.send("app:ready-close", null);
      } catch (error) {
        ipcRenderer.send("app:ready-close", String(error.message || error));
      }
    };
    ipcRenderer.on("app:before-close", listener);
    return () => ipcRenderer.removeListener("app:before-close", listener);
  },
});
