const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cleaner", {
  getState: () => ipcRenderer.invoke("state:get"),
  startProxy: (port) => ipcRenderer.invoke("proxy:start", port),
  stopProxy: () => ipcRenderer.invoke("proxy:stop"),
  installMitmproxy: () => ipcRenderer.invoke("mitmproxy:install"),
  resetProgress: () => ipcRenderer.invoke("progress:reset"),
  openExternal: (url) => ipcRenderer.invoke("open:external", url),
  onStateUpdate: (callback) => {
    ipcRenderer.on("state:update", (_, state) => callback(state));
  }
});
