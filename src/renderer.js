const FIXED_PORT = 9091;

const steps = [
  ["proxyStarted", "代理服务已启动"],
  ["addonLoaded", "清理规则已加载"],
  ["certificatePageOpened", "iPhone 已打开证书页面"],
  ["claudeRequestSeen", "已检测到 Claude/Anthropic 请求"],
  ["cookiesRemoved", "已从请求中删除问题 Cookie"],
  ["expireCookiesSent", "已发送 Cookie 过期响应"]
];

let latestState = null;

const startButton = document.getElementById("startButton");
const installButton = document.getElementById("installButton");
const serviceMessage = document.getElementById("serviceMessage");
const errorBox = document.getElementById("errorBox");

startButton.addEventListener("click", async () => {
  if (!latestState?.mitmdumpPath) {
    showInstallPrompt();
    return;
  }

  startButton.disabled = true;
  serviceMessage.textContent = "正在启动代理...";
  try {
    await window.cleaner.startProxy(FIXED_PORT);
  } catch (error) {
    showError(error.message || "代理启动失败。");
  } finally {
    startButton.disabled = false;
  }
});

installButton.addEventListener("click", async () => {
  installButton.disabled = true;
  serviceMessage.textContent = "正在安装 mitmproxy，请稍等...";
  try {
    await window.cleaner.installMitmproxy();
  } catch (error) {
    showError(error.message || "mitmproxy 安装失败。");
  }
});

window.cleaner.onStateUpdate(render);
window.cleaner.getState().then(render);

function render(state) {
  latestState = state;

  startButton.disabled = Boolean(state.proxyRunning || state.installingMitmproxy);
  startButton.textContent = state.proxyRunning ? "代理已启动" : "启动代理";

  installButton.hidden = Boolean(state.mitmdumpPath || state.proxyRunning);
  installButton.disabled = Boolean(state.installingMitmproxy);
  installButton.textContent = state.installingMitmproxy ? "安装中..." : "安装 mitmproxy";

  if (state.lastError) {
    showError(state.lastError);
  } else {
    errorBox.hidden = true;
  }

  if (state.proxyRunning) {
    serviceMessage.textContent = "服务已启动。请继续完成第 2 步 iPhone 设置。";
  } else if (state.installingMitmproxy) {
    serviceMessage.textContent = "正在安装 mitmproxy，请稍等...";
  } else if (!state.mitmdumpPath && !serviceMessage.textContent) {
    serviceMessage.textContent = "点击启动代理后，如检测到未安装 mitmproxy，会提示先安装。";
  } else if (state.mitmdumpPath && !state.lastError) {
    serviceMessage.textContent = "已检测到 mitmproxy，可以启动代理。";
  }

  renderProgress(state.steps);
}

function showInstallPrompt() {
  installButton.hidden = false;
  serviceMessage.textContent = "未检测到 mitmproxy。请先安装，安装完成后再启动代理。";
  errorBox.hidden = true;
}

function showError(message) {
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function renderProgress(stepState) {
  const progressList = document.getElementById("progressList");
  progressList.innerHTML = "";

  for (const [key, label] of steps) {
    const row = document.createElement("div");
    row.className = `progress-item ${stepState[key] ? "done" : ""}`;
    row.innerHTML = `<span>${stepState[key] ? "✓" : ""}</span><strong>${escapeHtml(label)}</strong>`;
    progressList.append(row);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}
