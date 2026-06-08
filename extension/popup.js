const el = {
  status: document.getElementById("status"),
  message: document.getElementById("message"),
  propTitle: document.getElementById("propTitle"),
  propUrl: document.getElementById("propUrl"),
  propCreated: document.getElementById("propCreated"),
  propTags: document.getElementById("propTags"),
  subtitleSelect: document.getElementById("subtitleSelect"),
  preview: document.getElementById("preview"),
  refreshBtn: document.getElementById("refreshBtn"),
  copyBtn: document.getElementById("copyBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  sendBtn: document.getElementById("sendBtn"),
  settingsBtn: document.getElementById("settingsBtn")
};

let latestPayload = null;
const DEFAULT_SETTINGS = {
  downloadFormat: "srt"
};

function formatLocalDate(value = Date.now()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

init().catch((error) => {
  setStatus(`初始化失败：${error.message}`);
});

async function init() {
  bindEvents();
  const tab = await getActiveTab();
  if (isYouTubePage(tab?.url || "")) {
    await initYouTubeMode(tab);
    return;
  }
  await refreshFromTab();
}

function bindEvents() {
  el.refreshBtn.addEventListener("click", async () => {
    await refreshFromTab();
  });

  el.copyBtn.addEventListener("click", async () => {
    const payload = await ensurePayload();
    if (!payload?.markdown) {
      setMessage("没有可复制内容，请先刷新。");
      return;
    }
    try {
      await navigator.clipboard.writeText(payload.markdown);
      setMessage("已复制完整 Markdown。");
    } catch (error) {
      setMessage(`复制失败：${error?.message || "无法访问剪贴板"}`);
    }
  });

  el.downloadBtn.addEventListener("click", async () => {
    const payload = await ensurePayload();
    const settings = await getSettingsFromRuntime();
    const format = normalizeDownloadFormat(settings?.downloadFormat || payload?.downloadFormat);
    const content =
      format === "txt" ? payload?.txt || payload?.subtitlePreview || "" : payload?.srt || "";
    if (!content) {
      setMessage("没有可下载字幕。");
      return;
    }
    const safeTitle = sanitizeFileName(payload.title || "bilibili-subtitle");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeTitle}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMessage(`已下载 ${format.toUpperCase()}。`);
  });

  el.sendBtn.addEventListener("click", async () => {
    setStatus("正在发送到 Obsidian...");
    const resp = await sendToContent({ type: "popup-send-obsidian" });
    if (!resp?.ok) {
      setMessage(`发送失败：${resp?.error || "未知错误"}`);
    }
    render(resp?.payload || latestPayload);
  });

  el.subtitleSelect.addEventListener("change", async (event) => {
    const option = event.target.options[event.target.selectedIndex];
    const url = String(option?.value || "");
    if (!url) {
      return;
    }
    setStatus("正在切换字幕...");
    const resp = await sendToContent({
      type: "popup-select-subtitle",
      url,
      lang: String(option.dataset.lang || "unknown"),
      subtitleId: String(option.dataset.id || "")
    });
    if (!resp?.ok) {
      setMessage(`切换失败：${resp?.error || "未知错误"}`);
    }
    render(resp?.payload || latestPayload);
  });

  el.settingsBtn.addEventListener("click", async () => {
    await sendToRuntime({ type: "open-options" });
  });

  const batchBtn = document.getElementById("batchBtn");
  if (batchBtn) {
    batchBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("batch/batch.html") });
    });
  }
}

async function refreshFromTab() {
  setStatus("正在抓取...");
  const resp = await sendToContent({ type: "popup-refresh" });
  if (!resp?.ok) {
    const errorText = resp?.error || "请在 B 站视频页使用。";
    setStatus(`抓取失败：${errorText}`);
  }
  render(resp?.payload || latestPayload);
}

async function ensurePayload() {
  if (latestPayload) {
    return latestPayload;
  }
  const resp = await sendToContent({ type: "popup-get-state" });
  if (resp?.ok && resp.payload) {
    latestPayload = resp.payload;
  }
  return latestPayload;
}

function render(payload) {
  if (!payload) {
    return;
  }
  latestPayload = payload;

  setStatus(payload.status || "准备就绪");
  setMessage(payload.message || "");

  setText(el.propTitle, payload.title || "-");
  setText(el.propUrl, payload.url || "-");
  setText(el.propCreated, formatLocalDate());
  setText(el.propTags, payload.tags || "clippings");
  el.propTitle.title = payload.title || "";
  el.propUrl.title = payload.url || "";

  const options = payload.subtitleOptions || [];
  if (options.length === 0) {
    el.subtitleSelect.innerHTML = '<option value="">暂无字幕</option>';
    el.subtitleSelect.disabled = true;
  } else {
    el.subtitleSelect.innerHTML = options
      .map((item) => {
        const selected = item.selected ? "selected" : "";
        const aiTag = item.isAi ? " [AI]" : "";
        return `<option value="${escapeHtml(item.url)}" data-id="${escapeHtml(
          item.id || ""
        )}" data-lang="${escapeHtml(item.lang || "")}" ${selected}>${escapeHtml(
          `${item.lang || "unknown"}${aiTag}`
        )}</option>`;
      })
      .join("");
    el.subtitleSelect.disabled = false;
  }

  el.preview.value = payload.subtitlePreview || "";
}

function setText(node, text) {
  node.textContent = String(text || "");
}

function setStatus(text) {
  el.status.textContent = String(text || "");
}

function setMessage(text) {
  el.message.textContent = String(text || "");
}

function sanitizeFileName(value) {
  return String(value || "subtitle")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function normalizeDownloadFormat(value) {
  return value === "txt" ? "txt" : "srt";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0] || null;
}

async function getActiveTabId() {
  const tab = await getActiveTab();
  return tab?.id || null;
}

async function sendToContent(message) {
  const tab = await getActiveTab();
  const tabId = tab?.id || null;
  const url = tab?.url || "";
  if (!tabId) {
    throw new Error("找不到当前标签页");
  }

  // YouTube 页面不支持 Bilibili 的 popup 消息
  if (isYouTubePage(url)) {
    return { ok: false, error: "YouTube 视频请使用批量下载模式" };
  }

  try {
    return await sendMessageToTab(tabId, message);
  } catch (error) {
    if (shouldRetryAfterInjection(error) && isBilibiliPage(url)) {
      try {
        await ensureContentScriptReady(tabId);
        await sleep(80);
        return await sendMessageToTab(tabId, message);
      } catch (retryError) {
        error = retryError;
      }
    }

    const normalizedError = normalizeContentErrorMessage(error);
    setStatus("请在 B 站视频页使用插件。");
    setMessage(normalizedError);
    return { ok: false, error: normalizedError, payload: latestPayload };
  }
}

function normalizeContentErrorMessage(error) {
  const message = String(error?.message || "").trim();
  if (message.includes("Could not establish connection. Receiving end does not exist.")) {
    return "请刷新浏览器网页重试，或当前网页不支持";
  }
  return message || "未知错误";
}

function shouldRetryAfterInjection(error) {
  const message = String(error?.message || "");
  return message.includes("Could not establish connection. Receiving end does not exist.");
}

function isSupportedSubtitlePage(url) {
  return isBilibiliPage(url) || isYouTubePage(url);
}

function isBilibiliPage(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.hostname !== "www.bilibili.com") {
      return false;
    }
    return parsed.pathname === "/list/watchlater" ||
      parsed.pathname === "/list/watchlater/" ||
      parsed.pathname.startsWith("/video/");
  } catch {
    return false;
  }
}

function isYouTubePage(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.hostname === "www.youtube.com" ||
      parsed.hostname === "youtube.com" ||
      parsed.hostname === "youtu.be";
  } catch {
    return false;
  }
}

async function initYouTubeMode(tab) {
  setStatus("检测到 YouTube 视频页");
  setMessage("YouTube 视频请使用批量下载模式，或点击下方按钮直接跳转。");

  // 尝试注入 YouTube content script 并获取基本信息
  try {
    await ensureYouTubeContentScriptReady(tab.id);
    await sleep(200);
    const resp = await sendMessageToTab(tab.id, { type: "ytc-get-info" });
    if (resp?.ok && resp.data) {
      const data = resp.data;
      setText(el.propTitle, data.title || "-");
      setText(el.propUrl, tab.url || "-");
      setText(el.propCreated, formatLocalDate());
      setText(el.propTags, "youtube");
      el.propTitle.title = data.title || "";
      el.propUrl.title = tab.url || "";

      el.subtitleSelect.innerHTML = data.tracks.length > 0
        ? data.tracks.map((t, i) => `<option value="${i}">${escapeHtml(t.name || t.languageCode)}${t.kind === "asr" ? " [AI]" : ""}</option>`).join("")
        : '<option value="">暂无字幕</option>';
      el.subtitleSelect.disabled = data.tracks.length === 0;

      setStatus(`YouTube 视频 — ${data.trackCount} 个字幕轨道`);
    } else {
      setText(el.propTitle, "YouTube 视频");
      setText(el.propUrl, tab.url || "-");
    }
  } catch (e) {
    console.warn("[Popup] YouTube init failed", e);
    setText(el.propTitle, "YouTube 视频");
    setText(el.propUrl, tab.url || "-");
  }

  // 禁用 Bilibili 专用按钮
  el.refreshBtn.disabled = true;
  el.copyBtn.disabled = true;
  el.downloadBtn.disabled = true;
  el.preview.value = "";

  // 修改发送按钮为跳转批量下载
  el.sendBtn.textContent = "打开 YouTube 批量下载";
  el.sendBtn.onclick = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("batch/youtube.html") });
  };
}

async function ensureYouTubeContentScriptReady(tabId) {
  if (!chrome.scripting) {
    throw new Error("不支持的内容脚本注入");
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["youtube-content.js"]
    });
  } catch (error) {
    console.log("[Popup] YouTube content script injection result", error?.message || "ok");
  }
}

async function ensureContentScriptReady(tabId) {
  if (!chrome.scripting) {
    throw new Error("请刷新浏览器网页重试，或当前网页不支持");
  }

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content.css"]
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(resp);
    });
  });
}

async function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function sendToRuntime(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(resp);
    });
  });
}

async function getSettingsFromRuntime() {
  try {
    const resp = await sendToRuntime({ type: "get-settings" });
    if (!resp?.ok) {
      return { ...DEFAULT_SETTINGS };
    }
    return { ...DEFAULT_SETTINGS, ...(resp.settings || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
