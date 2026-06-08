/**
 * YouTube 批量字幕下载
 * 功能：扫描所有打开的 YouTube 视频标签页，选择字幕语言，批量下载到 Obsidian
 */

const DEFAULT_SETTINGS = {
  noteFolder: "Clippings/YouTube",
  obsidianApiBaseUrl: "http://127.0.0.1:27123",
  obsidianApiKey: "",
  tags: "clippings,youtube",
  downloadFormat: "srt",
  includeDateInFilename: true,
  includeTimestampInBody: true,
  frontmatterFields: [
    "title", "url", "video_id", "channel", "subtitle_lang", "created", "tags"
  ]
};

const state = {
  videos: [],
  isRunning: false,
  settings: { ...DEFAULT_SETTINGS }
};

// ============ 初始化 ============

async function init() {
  bindEvents();
  await loadSettings();
}

function bindEvents() {
  document.getElementById("closeBtn").addEventListener("click", () => window.close());
  document.getElementById("scanBtn").addEventListener("click", scanTabs);
  document.getElementById("autoSelectBtn").addEventListener("click", autoSelectTracks);
  document.getElementById("startBtn").addEventListener("click", startDownload);
}

async function loadSettings() {
  try {
    const resp = await sendRuntimeMessage({ type: "get-settings" });
    if (resp?.ok && resp.settings) {
      state.settings = { ...DEFAULT_SETTINGS, ...resp.settings };
    }
  } catch (e) {
    console.warn("[YTBatch] load settings failed", e);
  }
}

// ============ 标签页扫描 ============

async function scanTabs() {
  if (state.isRunning) return;

  setStatus("正在扫描 YouTube 标签页...");
  state.videos = [];
  hideResultSummary();

  try {
    // 调试：先查询所有标签页，看看实际有哪些 URL
    const allTabsDebug = await chrome.tabs.query({});
    const youtubeLikeTabs = allTabsDebug.filter(t => (t.url || "").includes("youtube.com"));
    console.log("[YTBatch] all tabs:", allTabsDebug.map(t => t.url));
    console.log("[YTBatch] youtube-like tabs:", youtubeLikeTabs.map(t => t.url));

    // 方式 1：match pattern 匹配（* 匹配任意路径）
    let tabs = await chrome.tabs.query({
      url: [
        "https://www.youtube.com/*",
        "https://youtube.com/*",
        "https://youtu.be/*"
      ]
    });
    console.log("[YTBatch] query match pattern result:", tabs.length, tabs.map(t => t.url));

    // 方式 2：如果仍为空，用单个通配符再试
    if (tabs.length === 0) {
      tabs = await chrome.tabs.query({ url: "*://*.youtube.com/*" });
      console.log("[YTBatch] query *://*.youtube.com/* result:", tabs.length);
    }

    // 方式 3：回退到查询所有标签页手动过滤
    if (tabs.length === 0) {
      const allTabs = await chrome.tabs.query({});
      tabs = allTabs.filter(tab => {
        const url = tab.url || "";
        return url.includes("youtube.com/watch") ||
               url.includes("youtube.com/shorts") ||
               url.includes("youtube.com/live") ||
               url.includes("youtu.be/");
      });
      console.log("[YTBatch] fallback filter result:", tabs.length, tabs.map(t => t.url));
    }

    if (tabs.length === 0) {
      setStatus(`未找到打开的 YouTube 视频标签页。(调试：共 ${allTabsDebug.length} 个标签页，其中 ${youtubeLikeTabs.length} 个含 youtube.com)`);
      renderVideoList();
      return;
    }

    // 去重（按 videoId）
    const seen = new Map();
    for (const tab of tabs) {
      const videoId = extractVideoId(tab.url);
      console.log("[YTBatch] extract videoId from", tab.url, "=>", videoId);
      if (videoId && !seen.has(videoId)) {
        seen.set(videoId, { tabId: tab.id, url: tab.url, videoId });
      }
    }

    const uniqueVideos = Array.from(seen.values());
    setStatus(`找到 ${uniqueVideos.length} 个唯一视频，正在获取字幕信息...`);

    // 逐个获取（需要注入 content script）
    for (let i = 0; i < uniqueVideos.length; i++) {
      const v = uniqueVideos[i];
      try {
        await fetchAndEnrichVideo(v);
      } catch (error) {
        console.warn(`[YTBatch] fetch failed for ${v.videoId}`, error);
        v.title = `【获取失败】${v.videoId}`;
        v.error = getErrorMessage(error);
      }
      setStatus(`正在获取字幕信息... (${i + 1} / ${uniqueVideos.length})`);
      await sleep(300);
    }

    state.videos = uniqueVideos.filter(v => v.title);

    // 默认全部选中
    for (const v of state.videos) {
      v.selected = true;
      v.selectedTrackIndex = -1; // -1 = 未选择
    }

    setStatus(`扫描完成，共 ${state.videos.length} 个视频，${state.videos.filter(v => v.trackCount > 0).length} 个有字幕。`);
    renderVideoList();
  } catch (error) {
    setStatus(`扫描失败：${getErrorMessage(error)}`);
    console.error("[YTBatch] scan error", error);
  }
}

async function fetchAndEnrichVideo(video) {
  // 先确保 content script 已注入
  try {
    await ensureContentScriptReady(video.tabId);
    await sleep(200);
  } catch (e) {
    console.warn("[YTBatch] inject content script failed", e);
  }

  // 获取视频信息
  const resp = await sendMessageToTab(video.tabId, { type: "ytc-get-info" });
  if (!resp?.ok) {
    throw new Error(resp?.error || "无法获取视频信息");
  }

  const data = resp.data;
  video.title = data.title || "";
  video.channel = data.channel || "";
  video.duration = data.duration || 0;
  video.trackCount = data.trackCount || 0;
  video.tracks = data.tracks || [];
}

async function ensureContentScriptReady(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["youtube-content.js"]
    });
  } catch (error) {
    // 可能已经注入过了
    console.log("[YTBatch] content script injection result", error?.message || "ok");
  }
}

// ============ 自动选择最佳字幕 ============

function autoSelectTracks() {
  const preferManual = document.getElementById("preferManual").checked;
  const preferredLang = document.getElementById("langSelect").value;

  for (const v of state.videos) {
    if (!v.tracks || v.tracks.length === 0) continue;

    const track = pickBestTrack(v.tracks, preferredLang, preferManual);
    if (track) {
      v.selectedTrackIndex = v.tracks.findIndex(t =>
        t.languageCode === track.languageCode && t.baseUrl === track.baseUrl
      );
    }
  }

  renderVideoList();
  setStatus("已自动选择最佳字幕轨道。");
}

function pickBestTrack(tracks, preferredLang, preferManual) {
  if (!tracks || tracks.length === 0) return null;

  let candidates = [...tracks];

  // 1. 如果优先手动字幕，过滤掉 asr（自动生成的）
  if (preferManual) {
    const manual = candidates.filter(t => t.kind !== "asr");
    if (manual.length > 0) candidates = manual;
  }

  // 2. 语言匹配
  if (preferredLang) {
    const exact = candidates.filter(t => t.languageCode === preferredLang);
    if (exact.length > 0) candidates = exact;
    else {
      const prefix = candidates.filter(t => t.languageCode.startsWith(preferredLang));
      if (prefix.length > 0) candidates = prefix;
    }
  } else {
    // 没有指定语言时，优先中文 > 英文 > 其他
    const priority = ["zh", "zh-Hans", "zh-CN", "zh-TW", "en", "en-US", "en-GB", "ja", "ko"];
    for (const lang of priority) {
      const match = candidates.filter(t => t.languageCode === lang || t.languageCode.startsWith(lang));
      if (match.length > 0) {
        candidates = match;
        break;
      }
    }
  }

  // 3. 优先手动字幕（在已过滤的候选中）
  const manualFirst = candidates.filter(t => t.kind !== "asr");
  if (manualFirst.length > 0) candidates = manualFirst;

  return candidates[0] || null;
}

// ============ 批量下载 ============

async function startDownload() {
  if (state.isRunning) return;

  const selectedVideos = state.videos.filter(v => v.selected && v.selectedTrackIndex >= 0);
  if (selectedVideos.length === 0) {
    setStatus("请先选择至少一个视频及其字幕语言。");
    return;
  }

  const format = document.getElementById("formatSelect").value;
  state.isRunning = true;
  updateToolbarState();
  showProgress(0, selectedVideos.length);

  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  setStatus(`开始下载，共 ${selectedVideos.length} 个字幕任务...`);

  for (let i = 0; i < selectedVideos.length; i++) {
    const video = selectedVideos[i];
    if (!state.isRunning) break;

    try {
      await downloadOneVideo(video, format);
      successCount++;
      updateVideoStatus(video.videoId, "success", "已保存到 Obsidian");
    } catch (error) {
      const msg = getErrorMessage(error);
      if (msg.includes("暂无") || msg.includes("没有") || msg.includes("空") || msg.includes("禁用")) {
        skippedCount++;
        updateVideoStatus(video.videoId, "skipped", msg);
      } else {
        failedCount++;
        updateVideoStatus(video.videoId, "failed", msg);
      }
    }

    updateProgress(i + 1, selectedVideos.length);
    await sleep(1000); // YouTube 间隔稍长，避免限流
  }

  state.isRunning = false;
  updateToolbarState();
  hideProgress();

  setStatus(`下载完成：成功 ${successCount} | 跳过 ${skippedCount} | 失败 ${failedCount}`);
  showResultSummary(successCount, skippedCount, failedCount);
}

async function downloadOneVideo(video, format) {
  const track = video.tracks[video.selectedTrackIndex];
  if (!track) {
    throw new Error("未选择字幕轨道");
  }

  // 获取字幕内容
  const resp = await sendMessageToTab(video.tabId, {
    type: "ytc-fetch-subtitle",
    url: track.baseUrl
  });

  if (!resp?.ok) {
    throw new Error(resp?.error || "字幕获取失败");
  }

  const body = resp.body;
  if (!body || body.length === 0) {
    throw new Error("字幕内容为空");
  }

  // 生成内容
  const meta = {
    videoId: video.videoId,
    title: video.title,
    channel: video.channel,
    subtitleLang: track.name || track.languageCode,
    url: video.url,
    tags: state.settings.tags
  };

  let content = "";
  if (format === "md") {
    content = buildMarkdownContent(meta, body);
  } else if (format === "srt") {
    content = buildSrtContent(body);
  } else {
    content = buildTxtContent(body);
  }

  // 构建文件名
  const safeTitle = sanitizeFileName(video.title || video.videoId);
  const safeLang = sanitizeFileName(track.languageCode || "subtitle");
  const filename = `${safeTitle}_${safeLang}.${format}`;

  const folder = normalizeFolder(state.settings.noteFolder || "Clippings/YouTube");
  const filepath = folder ? `${folder}/${filename}` : filename;

  // 保存到 Obsidian
  const baseUrl = String(state.settings.obsidianApiBaseUrl || "").trim();
  const apiKey = String(state.settings.obsidianApiKey || "").trim();

  if (!baseUrl || !apiKey) {
    throw new Error("请先在插件设置中配置 Obsidian Local REST API");
  }

  await writeNoteByLocalApi(baseUrl, apiKey, filepath, content);
}

// ============ Obsidian API ============

async function writeNoteByLocalApi(baseUrl, apiKey, filepath, content) {
  const resp = await sendRuntimeMessage({
    type: "write-obsidian-note",
    baseUrl,
    apiKey,
    filepath,
    content
  });
  if (!resp?.ok) {
    throw new Error(resp?.error || "Obsidian 写入失败");
  }
}

// ============ 内容生成 ============

function buildMarkdownContent(meta, body) {
  const frontmatter = {};
  frontmatter.title = meta.title;
  frontmatter.url = meta.url;
  frontmatter.video_id = meta.videoId;
  frontmatter.channel = meta.channel;
  frontmatter.subtitle_lang = meta.subtitleLang;
  frontmatter.created = formatLocalDate();
  frontmatter.tags = meta.tags;

  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(`${key}: ${String(value || "")}`);
  }
  lines.push("---");
  lines.push("");
  lines.push(`# ${meta.title}`);
  lines.push("");

  for (const item of body) {
    const from = formatTime(item.from || 0);
    lines.push(`**[${from}]** ${String(item.content || "").trim()}`);
  }

  lines.push("");
  return lines.join("\n");
}

function buildSrtContent(body) {
  const lines = [];
  for (let i = 0; i < body.length; i++) {
    const item = body[i];
    lines.push(String(i + 1));
    lines.push(`${formatSrtTime(item.from || 0)} --> ${formatSrtTime(item.to || 0)}`);
    lines.push(String(item.content || "").trim());
    lines.push("");
  }
  return lines.join("\n");
}

function buildTxtContent(body) {
  return body.map(item => String(item.content || "").trim()).join("\n");
}

// ============ UI 渲染 ============

function renderVideoList() {
  const container = document.getElementById("videoList");
  if (state.videos.length === 0) {
    container.innerHTML = '<div class="batch-status">暂无视频，请点击"扫描标签页"。</div>';
    return;
  }

  container.innerHTML = state.videos.map(v => {
    const trackOptions = v.tracks.map((t, idx) => {
      const selected = v.selectedTrackIndex === idx ? "selected" : "";
      const kindLabel = t.kind === "asr" ? " [AI]" : "";
      return `<option value="${idx}" ${selected}>${escapeHtml(t.name || t.languageCode)}${kindLabel}</option>`;
    }).join("");

    const noTrackOption = v.trackCount === 0
      ? '<option value="-1" selected>无可用字幕</option>'
      : '<option value="-1">选择字幕...</option>';

    return `
    <div class="video-item" data-vid="${escapeHtml(v.videoId)}">
      <div class="video-checkbox">
        <input type="checkbox" ${v.selected ? "checked" : ""} data-vid="${escapeHtml(v.videoId)}" ${state.isRunning ? "disabled" : ""}>
      </div>
      <div class="video-info">
        <div class="video-title">${escapeHtml(v.title || v.videoId)}</div>
        <div class="video-meta">
          <span>ID: ${escapeHtml(v.videoId)}</span>
          <span>频道: ${escapeHtml(v.channel || "-")}</span>
          <span>字幕: ${v.trackCount} 种</span>
        </div>
        ${v.error ? `<div class="error-detail">${escapeHtml(v.error)}</div>` : ""}
      </div>
      <div class="video-actions">
        <select class="track-select" data-vid="${escapeHtml(v.videoId)}" ${v.trackCount === 0 || state.isRunning ? "disabled" : ""}>
          ${noTrackOption}${trackOptions}
        </select>
      </div>
      <div class="video-status" data-vid="${escapeHtml(v.videoId)}"></div>
    </div>
  `;}).join("");

  // 绑定事件
  container.querySelectorAll(".video-checkbox input").forEach(cb => {
    cb.addEventListener("change", (e) => {
      const vid = e.target.dataset.vid;
      const video = state.videos.find(v => v.videoId === vid);
      if (video) video.selected = e.target.checked;
    });
  });

  container.querySelectorAll(".track-select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const vid = e.target.dataset.vid;
      const video = state.videos.find(v => v.videoId === vid);
      if (video) {
        video.selectedTrackIndex = Number(e.target.value);
      }
    });
  });
}

function updateVideoStatus(videoId, status, message) {
  const el = document.querySelector(`.video-status[data-vid="${CSS.escape(videoId)}"]`);
  if (!el) return;

  const item = el.closest(".video-item");
  item.classList.remove("success", "failed", "skipped");

  const statusClass = status === "success" ? "status-success" : status === "failed" ? "status-failed" : "status-skipped";
  const icon = status === "success" ? "✓" : status === "failed" ? "✗" : "○";
  el.innerHTML = `<span class="${statusClass}">${icon} ${escapeHtml(message)}</span>`;

  if (status === "success") item.classList.add("success");
  else if (status === "failed") item.classList.add("failed");
  else item.classList.add("skipped");
}

function updateToolbarState() {
  const disabled = state.isRunning;
  document.getElementById("scanBtn").disabled = disabled;
  document.getElementById("autoSelectBtn").disabled = disabled;
  document.getElementById("startBtn").disabled = disabled;
  document.getElementById("formatSelect").disabled = disabled;
  document.getElementById("langSelect").disabled = disabled;
  document.getElementById("preferManual").disabled = disabled;
}

function showProgress(current, total) {
  const el = document.getElementById("progress");
  el.style.display = "flex";
  updateProgress(current, total);
}

function updateProgress(current, total) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  document.getElementById("progressFill").style.width = `${pct}%`;
  document.getElementById("progressText").textContent = `${current} / ${total}`;
}

function hideProgress() {
  document.getElementById("progress").style.display = "none";
}

function showResultSummary(success, skipped, failed) {
  const el = document.getElementById("resultSummary");
  el.style.display = "block";
  el.innerHTML = `
    <h3>下载结果</h3>
    <div class="result-stats">
      <span class="stat stat-success">✓ 成功 ${success}</span>
      <span class="stat stat-skipped">○ 跳过 ${skipped}</span>
      <span class="stat stat-failed">✗ 失败 ${failed}</span>
    </div>
  `;
}

function hideResultSummary() {
  document.getElementById("resultSummary").style.display = "none";
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

// ============ 工具函数 ============

function extractVideoId(url) {
  const patterns = [
    /youtube\.com\/watch\?v=([0-9A-Za-z_-]{11})/,
    /youtube\.com\/shorts\/([0-9A-Za-z_-]{11})/,
    /youtube\.com\/embed\/([0-9A-Za-z_-]{11})/,
    /youtube\.com\/live\/([0-9A-Za-z_-]{11})/,
    /youtu\.be\/([0-9A-Za-z_-]{11})/,
    /[?&]v=([0-9A-Za-z_-]{11})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return "";
}

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function normalizeFolder(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "")
    .trim();
}

function formatLocalDate(value = Date.now()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(seconds) {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatSrtTime(seconds) {
  const ms = Math.floor((seconds % 1) * 1000);
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function getErrorMessage(error, fallback = "未知错误") {
  return String(error?.message || error || "").trim() || fallback;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    } catch (error) {
      reject(error);
    }
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

// ============ 启动 ============

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
