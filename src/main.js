const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const os = require("os");
const net = require("net");
const { spawn } = require("child_process");

const DEFAULT_PORT = 9091;
const EVENT_PREFIX = "CLAUDE_CLEANER_EVENT ";

let mainWindow;
let mitmProcess = null;
let installProcess = null;
let state = {
  mitmdumpPath: null,
  proxyRunning: false,
  port: DEFAULT_PORT,
  ipAddresses: [],
  lastError: null,
  installingMitmproxy: false,
  events: [],
  steps: {
    addonLoaded: false,
    proxyStarted: false,
    certificatePageOpened: false,
    claudeRequestSeen: false,
    cookiesRemoved: false,
    expireCookiesSent: false
  }
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 920,
    minHeight: 640,
    title: "Claude iOS Session Cleaner",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer.html"));
}

function pushState() {
  state.ipAddresses = getLanAddresses();
  state.mitmdumpPath = findMitmdumpSync();
  if (mainWindow) {
    mainWindow.webContents.send("state:update", state);
  }
}

function addEvent(type, payload = {}) {
  state.events.unshift({
    type,
    payload,
    at: new Date().toISOString()
  });
  state.events = state.events.slice(0, 80);
  pushState();
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const results = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses || []) {
      if (address.family !== "IPv4" || address.internal) continue;
      results.push({ name, address: address.address });
    }
  }

  return results;
}

function commandExists(command) {
  const separator = process.platform === "win32" ? ";" : ":";
  const paths = (process.env.PATH || "").split(separator);
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];

  for (const folder of paths) {
    for (const extension of extensions) {
      const candidate = path.join(folder, command + extension);
      try {
        require("fs").accessSync(candidate);
        return candidate;
      } catch (_) {
        // Try the next candidate.
      }
    }
  }

  return null;
}

function findMitmdumpSync() {
  return commandExists("mitmdump") || findWindowsUserMitmdump();
}

function findWindowsUserMitmdump() {
  if (process.platform !== "win32") return null;

  const appData = process.env.APPDATA;
  if (!appData) return null;

  try {
    const pythonDir = path.join(appData, "Python");
    const fs = require("fs");
    if (!fs.existsSync(pythonDir)) return null;

    for (const versionDir of fs.readdirSync(pythonDir)) {
      const candidate = path.join(pythonDir, versionDir, "Scripts", "mitmdump.exe");
      try {
        fs.accessSync(candidate);
        return candidate;
      } catch (_) {
        // Try the next Python user install path.
      }
    }
  } catch (_) {
    return null;
  }

  return null;
}

function getInstallerCommand() {
  if (process.platform === "darwin") {
    const brew = commandExists("brew");
    if (!brew) {
      throw new Error("Homebrew was not found. Install Homebrew first, then use this button again.");
    }
    return { command: brew, args: ["install", "mitmproxy"] };
  }

  if (process.platform === "win32") {
    const py = commandExists("py");
    if (py) {
      return { command: py, args: ["-3", "-m", "pip", "install", "--user", "mitmproxy"] };
    }

    const python = commandExists("python") || commandExists("python3");
    if (python) {
      return { command: python, args: ["-m", "pip", "install", "--user", "mitmproxy"] };
    }

    throw new Error("Python was not found. Install Python 3 first, then use this button again.");
  }

  const python3 = commandExists("python3") || commandExists("python");
  if (!python3) {
    throw new Error("Python was not found. Install Python 3 first, then use this button again.");
  }
  return { command: python3, args: ["-m", "pip", "install", "--user", "mitmproxy"] };
}

function installMitmproxy() {
  if (installProcess) return state;

  let installer;
  try {
    installer = getInstallerCommand();
  } catch (error) {
    state.lastError = error.message;
    pushState();
    throw error;
  }

  state.installingMitmproxy = true;
  state.lastError = null;
  addEvent("mitmproxy_install_started", { command: installer.command, args: installer.args });

  installProcess = spawn(installer.command, installer.args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  installProcess.stdout.on("data", (buffer) => {
    for (const line of buffer.toString().split(/\r?\n/)) {
      if (line.trim()) addEvent("install_log", { line });
    }
  });

  installProcess.stderr.on("data", (buffer) => {
    for (const line of buffer.toString().split(/\r?\n/)) {
      if (line.trim()) addEvent("install_log", { line });
    }
  });

  installProcess.once("exit", (code, signal) => {
    installProcess = null;
    state.installingMitmproxy = false;
    if (code === 0) {
      state.lastError = null;
      addEvent("mitmproxy_install_finished", { code, signal });
    } else {
      state.lastError = `mitmproxy install failed with code ${code}.`;
      addEvent("mitmproxy_install_failed", { code, signal });
    }
    pushState();
  });

  pushState();
  return state;
}

function getAddonPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "proxy", "claude_cookie_cleaner.py");
  }

  return path.join(app.getAppPath(), "proxy", "claude_cookie_cleaner.py");
}

function waitForPort(port, host = "127.0.0.1", timeoutMs = 4000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = new net.Socket();

      socket.setTimeout(700);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("timeout", () => {
        socket.destroy();
        retry();
      });
      socket.once("error", () => {
        socket.destroy();
        retry();
      });
      socket.connect(port, host);
    };

    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Proxy did not open port ${port} within ${timeoutMs}ms.`));
        return;
      }
      setTimeout(tryConnect, 250);
    };

    tryConnect();
  });
}

async function startProxy(port = DEFAULT_PORT) {
  if (mitmProcess) {
    return state;
  }

  const mitmdump = findMitmdumpSync();
  if (!mitmdump) {
    state.lastError = "mitmdump was not found. Install mitmproxy first, then restart this app.";
    pushState();
    throw new Error(state.lastError);
  }

  const addonPath = getAddonPath();
  state.lastError = null;
  state.port = Number(port) || DEFAULT_PORT;

  mitmProcess = spawn(mitmdump, [
    "-q",
    "--listen-host",
    "0.0.0.0",
    "--listen-port",
    String(state.port),
    "-s",
    addonPath
  ], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  mitmProcess.stdout.on("data", (buffer) => {
    for (const line of buffer.toString().split(/\r?\n/)) {
      if (!line.trim()) continue;
      parseProxyLine(line);
    }
  });

  mitmProcess.stderr.on("data", (buffer) => {
    for (const line of buffer.toString().split(/\r?\n/)) {
      if (!line.trim()) continue;
      addEvent("proxy_log", { line });
    }
  });

  mitmProcess.once("exit", (code, signal) => {
    addEvent("proxy_stopped", { code, signal });
    mitmProcess = null;
    state.proxyRunning = false;
    state.steps.proxyStarted = false;
    pushState();
  });

  await waitForPort(state.port);
  state.proxyRunning = true;
  state.steps.proxyStarted = true;
  addEvent("proxy_started", { port: state.port });
  pushState();
  return state;
}

function parseProxyLine(line) {
  if (!line.startsWith(EVENT_PREFIX)) {
    addEvent("proxy_log", { line });
    return;
  }

  try {
    const payload = JSON.parse(line.slice(EVENT_PREFIX.length));
    switch (payload.event) {
      case "addon_loaded":
        state.steps.addonLoaded = true;
        break;
      case "iphone_certificate_page_opened":
        state.steps.certificatePageOpened = true;
        break;
      case "claude_request_seen":
        state.steps.claudeRequestSeen = true;
        break;
      case "cookies_removed":
        state.steps.cookiesRemoved = true;
        break;
      case "expire_cookies_sent":
        state.steps.expireCookiesSent = true;
        break;
      default:
        break;
    }
    addEvent(payload.event, payload);
  } catch (error) {
    addEvent("proxy_log", { line });
  }
}

function stopProxy() {
  if (!mitmProcess) {
    state.proxyRunning = false;
    state.steps.proxyStarted = false;
    pushState();
    return state;
  }

  mitmProcess.kill();
  mitmProcess = null;
  state.proxyRunning = false;
  state.steps.proxyStarted = false;
  addEvent("proxy_stop_requested");
  pushState();
  return state;
}

function resetProgress() {
  state.events = [];
  state.lastError = null;
  state.steps = {
    addonLoaded: false,
    proxyStarted: Boolean(mitmProcess),
    certificatePageOpened: false,
    claudeRequestSeen: false,
    cookiesRemoved: false,
    expireCookiesSent: false
  };
  pushState();
  return state;
}

ipcMain.handle("proxy:start", (_, port) => startProxy(port));
ipcMain.handle("proxy:stop", () => stopProxy());
ipcMain.handle("mitmproxy:install", () => installMitmproxy());
ipcMain.handle("progress:reset", () => resetProgress());
ipcMain.handle("state:get", () => {
  pushState();
  return state;
});
ipcMain.handle("open:external", (_, url) => shell.openExternal(url));

app.whenReady().then(() => {
  createWindow();
  pushState();
});

app.on("window-all-closed", () => {
  stopProxy();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopProxy();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
