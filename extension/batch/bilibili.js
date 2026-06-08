/**
 * Bilibili 批量字幕下载
 * 功能：扫描所有打开的 B 站视频标签页，A/B 选择，批量下载字幕到 Obsidian
 */

const DEFAULT_SETTINGS = {
  noteFolder: "Clippings/Bilibili",
  obsidianApiBaseUrl: "http://127.0.0.1:27123",
  obsidianApiKey: "",
  tags: "clippings,bilibili",
  downloadFormat: "srt",
  includeDateInFilename: true,
  includeTimestampInBody: true,
  frontmatterFields: [
    "title", "url", "bvid", "cid", "author", "upload_date", "subtitle_lang", "created", "tags"
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
  document.getElementById("selectAllABtn").addEventListener("click", () => selectAll("A"));
  document.getElementById("selectAllBBtn").addEventListener("click", () => selectAll("B"));
  document.getElementById("startBtn").addEventListener("click", startDownload);
  document.getElementById("autoSelectB").addEventListener("change", onAutoSelectBChange);
}

async function loadSettings() {
  try {
    const resp = await sendRuntimeMessage({ type: "get-settings" });
    if (resp?.ok && resp.settings) {
      state.settings = { ...DEFAULT_SETTINGS, ...resp.settings };
    }
  } catch (e) {
    console.warn("[Batch] load settings failed", e);
  }
}

// ============ 标签页扫描 ============

async function scanTabs() {
  if (state.isRunning) return;

  setStatus("正在扫描标签页...");
  state.videos = [];
  hideResultSummary();

  try {
    const tabs = await chrome.tabs.query({ url: "https://www.bilibili.com/video/*" });
    if (tabs.length === 0) {
      setStatus("未找到打开的 B 站视频标签页。");
      renderVideoList();
      return;
    }

    // 提取 BV 并去重，保留第一个出现的标签页
    const seen = new Map();
    for (const tab of tabs) {
      const bvid = extractBvid(tab.url);
      if (bvid && !seen.has(bvid)) {
        seen.set(bvid, { tabId: tab.id, url: tab.url, bvid });
      }
    }

    const uniqueVideos = Array.from(seen.values());
    setStatus(`找到 ${uniqueVideos.length} 个唯一视频，正在获取元数据...`);

    // 并行获取元数据（限制并发数）
    const batchSize = 3;
    for (let i = 0; i < uniqueVideos.length; i += batchSize) {
      const batch = uniqueVideos.slice(i, i + batchSize);
      await Promise.all(batch.map(v => fetchAndEnrichVideo(v)));
      setStatus(`正在获取元数据... (${Math.min(i + batchSize, uniqueVideos.length)} / ${uniqueVideos.length})`);
    }

    // 过滤掉获取失败且不是视频页的
    state.videos = uniqueVideos.filter(v => v.title);

    // 默认选择
    const autoB = document.getElementById("autoSelectB").checked;
    for (const v of state.videos) {
      if (v.pageCount > 1) {
        v.choice = autoB ? "B" : null;
      } else {
        v.choice = "A";
      }
      v.selected = true;
    }

    setStatus(`扫描完成，共 ${state.videos.length} 个视频，${state.videos.filter(v => v.pageCount > 1).length} 个多P视频。`);
    renderVideoList();
  } catch (error) {
    setStatus(`扫描失败：${getErrorMessage(error)}`);
    console.error("[Batch] scan error", error);
  }
}

async function fetchAndEnrichVideo(video) {
  try {
    const meta = await fetchVideoMeta(video.bvid);
    video.aid = meta.aid || "";
    video.title = meta.title || "";
    video.author = meta.author || "";
    video.uploadDate = meta.uploadDate || "";
    video.pageCount = Array.isArray(meta.pages) ? meta.pages.length : 1;
    video.pages = meta.pages || [];
    video.defaultCid = meta.defaultCid || "";
    video.defaultDuration = meta.defaultDuration || 0;
    video.description = meta.description || "";
  } catch (error) {
    console.warn(`[Batch] fetch meta failed for ${video.bvid}`, error);
    video.title = `【获取失败】${video.bvid}`;
    video.pageCount = 1;
    video.pages = [];
    video.error = getErrorMessage(error);
  }
}

// ============ API 调用 ============

async function fetchVideoMeta(bvid) {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const payload = await fetchBiliJson(url);
  if (payload.code !== 0) {
    throw new Error(payload?.message || "无法获取视频信息");
  }

  const data = payload.data || {};
  const pubdate = Number(data.pubdate || 0);
  const uploadDate = pubdate > 0 ? formatLocalDate(pubdate * 1000) : "";
  const pages = Array.isArray(data.pages) ? data.pages : [];

  return {
    aid: data.aid ? String(data.aid) : "",
    title: String(data.title || ""),
    author: String(data.owner?.name || ""),
    description: String(data.desc || ""),
    uploadDate,
    defaultCid: data.cid ? String(data.cid) : "",
    defaultDuration: Number(data.duration || 0) || 0,
    pages: pages.map(item => ({
      cid: String(item.cid || ""),
      page: Number(item.page || 0) || 0,
      part: String(item.part || "").trim(),
      duration: Number(item.duration || 0) || 0
    }))
  };
}

async function fetchSubtitleBundle(bvid, cid, aid = "") {
  const requests = [];
  const safeBvid = encodeURIComponent(String(bvid || ""));
  const safeCid = encodeURIComponent(String(cid || ""));
  const safeAid = encodeURIComponent(String(aid || ""));

  if (aid) {
    requests.push({
      source: "player-wbi-v2",
      url: `https://api.bilibili.com/x/player/wbi/v2?aid=${safeAid}&cid=${safeCid}${bvid ? `&bvid=${safeBvid}` : ""}`
    });
  }

  requests.push({
    source: "player-v2",
    url: `https://api.bilibili.com/x/player/v2${bvid ? `?bvid=${safeBvid}&` : "?"}cid=${safeCid}${aid ? `&aid=${safeAid}` : ""}`
  });

  for (const req of requests) {
    try {
      const payload = await fetchBiliJson(req.url);
      if (payload.code !== 0) {
        const err = new Error(payload?.message || "API 错误");
        err.code = payload.code;
        throw err;
      }
      const subtitles = payload.data?.subtitle?.subtitles || [];
      const tracks = subtitles.map(item => ({
        id: item?.id === undefined || item?.id === null ? "" : String(item.id),
        lan: item?.lan || "",
        lanDoc: item?.lan_doc || "",
        subtitleUrl: normalizeSubtitleUrl(item?.subtitle_url || "")
      })).filter(t => t.subtitleUrl);

      if (tracks.length > 0) {
        return { tracks, chapters: [] };
      }
    } catch (e) {
      console.warn(`[Batch] subtitle source ${req.source} failed`, e);
      continue;
    }
  }

  return { tracks: [], chapters: [] };
}

async function fetchSubtitleBody(url) {
  const resp = await fetchBiliJson(url);
  return Array.isArray(resp.body) ? resp.body : [];
}

async function fetchBiliJson(url) {
  const resp = await sendRuntimeMessage({ type: "fetch-json", url });
  if (!resp?.ok) {
    throw new Error(resp?.error || "请求失败");
  }
  return resp.data;
}

// ============ 批量下载 ============

async function startDownload() {
  if (state.isRunning) return;

  const selectedVideos = state.videos.filter(v => v.selected && v.choice);
  if (selectedVideos.length === 0) {
    setStatus("请先选择至少一个视频并设置 A/B。");
    return;
  }

  const format = document.getElementById("formatSelect").value;
  state.isRunning = true;
  updateToolbarState();
  showProgress(0, 0);

  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let totalTasks = 0;

  // 计算总任务数
  for (const v of selectedVideos) {
    if (v.choice === "B" && v.pages.length > 1) {
      totalTasks += v.pages.length;
    } else {
      totalTasks += 1;
    }
  }

  setStatus(`开始下载，共 ${totalTasks} 个字幕任务...`);

  let completed = 0;

  for (const video of selectedVideos) {
    const pagesToDownload = getPagesToDownload(video);

    for (const pageInfo of pagesToDownload) {
      if (!state.isRunning) break;

      try {
        await downloadOnePage(video, pageInfo, format);
        successCount++;
        updateVideoStatus(video.bvid, "success", `已下载 ${pageInfo.part || "P" + pageInfo.page}`);
      } catch (error) {
        const msg = getErrorMessage(error);
        if (msg.includes("暂无") || msg.includes("没有") || msg.includes("空")) {
          skippedCount++;
          updateVideoStatus(video.bvid, "skipped", msg);
        } else {
          failedCount++;
          updateVideoStatus(video.bvid, "failed", msg);
        }
      }

      completed++;
      updateProgress(completed, totalTasks);
      await sleep(800); // 间隔避免限流
    }
  }

  state.isRunning = false;
  updateToolbarState();
  hideProgress();

  setStatus(`下载完成：成功 ${successCount} | 跳过 ${skippedCount} | 失败 ${failedCount}`);
  showResultSummary(successCount, skippedCount, failedCount);
}

function getPagesToDownload(video) {
  if (video.choice === "B" && video.pages.length > 1) {
    return video.pages;
  }
  // A: 只下载第一P（或默认 CID）
  const firstPage = video.pages[0];
  if (firstPage) {
    return [firstPage];
  }
  return [{ cid: video.defaultCid, page: 1, part: "", duration: video.defaultDuration }];
}

async function downloadOnePage(video, pageInfo, format) {
  const bvid = video.bvid;
  const cid = pageInfo.cid || video.defaultCid;
  const aid = video.aid;

  if (!cid) {
    throw new Error("无法获取 CID");
  }

  // 获取字幕轨道
  const bundle = await fetchSubtitleBundle(bvid, cid, aid);
  if (bundle.tracks.length === 0) {
    throw new Error("该视频暂无可用字幕");
  }

  // 选择最佳轨道
  const track = pickPreferredTrack(bundle.tracks);
  if (!track) {
    throw new Error("没有匹配的字幕轨道");
  }

  // 获取字幕内容
  const body = await fetchSubtitleBody(track.subtitleUrl);
  if (body.length === 0) {
    throw new Error("字幕内容为空");
  }

  // 生成内容
  let content = "";
  const meta = {
    bvid,
    cid,
    aid,
    title: video.title,
    author: video.author,
    uploadDate: video.uploadDate,
    subtitleLang: track.lanDoc || track.lan,
    url: video.url,
    pageTitle: pageInfo.part,
    pageIndex: pageInfo.page,
    tags: state.settings.tags
  };

  if (format === "md") {
    content = buildMarkdownContent(meta, body, state.settings);
  } else if (format === "srt") {
    content = buildSrtContent(body);
  } else {
    content = buildTxtContent(body);
  }

  // 构建文件名
  const safeTitle = sanitizeFileName(video.title || bvid);
  const safePart = pageInfo.part ? sanitizeFileName(pageInfo.part) : "";
  const safeLang = sanitizeFileName(track.lanDoc || track.lan || "subtitle");

  let filename;
  if (safePart && video.pages.length > 1) {
    filename = `${safeTitle}_${safePart}_${safeLang}.${format}`;
  } else {
    filename = `${safeTitle}_${safeLang}.${format}`;
  }

  const folder = normalizeFolder(state.settings.noteFolder || "");
  const filepath = folder ? `${folder}/${filename}` : filename;

  // 直接下载到本地
  await downloadToFile(filepath, content);
}

function pickPreferredTrack(tracks) {
  if (!tracks || tracks.length === 0) return null;

  const priority = (t) => {
    const lan = String(t.lan || "").toLowerCase();
    if (lan === "zh-cn" || lan === "zh-hans") return 0;
    if (lan === "zh") return 1;
    if (lan.includes("zh")) return 2;
    if (lan === "en" || lan === "en-us") return 10;
    if (lan.includes("en")) return 11;
    return 50;
  };

  return [...tracks].sort((a, b) => priority(a) - priority(b))[0];
}

// ============ 文件下载 ============

function downloadToFile(filepath, content) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url: url,
      filename: filepath,
      saveAs: false
    }, (downloadId) => {
      URL.revokeObjectURL(url);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (downloadId === undefined) {
        reject(new Error("下载被拒绝或失败"));
        return;
      }
      resolve(downloadId);
    });
  });
}

// Obsidian API（保留为可选功能）
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

function buildMarkdownContent(meta, body, settings) {
  const fields = Array.isArray(settings?.frontmatterFields)
    ? settings.frontmatterFields
    : DEFAULT_SETTINGS.frontmatterFields;

  const frontmatter = {};
  if (fields.includes("title")) frontmatter.title = meta.title;
  if (fields.includes("url")) frontmatter.url = meta.url;
  if (fields.includes("bvid")) frontmatter.bvid = meta.bvid;
  if (fields.includes("cid")) frontmatter.cid = meta.cid;
  if (fields.includes("author")) frontmatter.author = meta.author;
  if (fields.includes("upload_date")) frontmatter.upload_date = meta.uploadDate;
  if (fields.includes("subtitle_lang")) frontmatter.subtitle_lang = meta.subtitleLang;
  if (fields.includes("created")) frontmatter.created = formatLocalDate();
  if (fields.includes("tags")) frontmatter.tags = meta.tags;

  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(`${key}: ${String(value || "")}`);
  }
  lines.push("---");
  lines.push("");

  if (meta.pageTitle) {
    lines.push(`# ${meta.title} — ${meta.pageTitle}`);
  } else {
    lines.push(`# ${meta.title}`);
  }
  lines.push("");

  if (settings?.includeTimestampInBody !== false) {
    for (const item of body) {
      const from = formatTime(item.from || 0);
      lines.push(`**[${from}]** ${String(item.content || "").trim()}`);
    }
  } else {
    for (const item of body) {
      lines.push(String(item.content || "").trim());
    }
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

  container.innerHTML = state.videos.map(v => `
    <div class="video-item" data-bvid="${escapeHtml(v.bvid)}">
      <div class="video-checkbox">
        <input type="checkbox" ${v.selected ? "checked" : ""} data-bvid="${escapeHtml(v.bvid)}" ${state.isRunning ? "disabled" : ""}>
      </div>
      <div class="video-info">
        <div class="video-title">${escapeHtml(v.title || v.bvid)}</div>
        <div class="video-meta">
          <span>BV: ${escapeHtml(v.bvid)}</span>
          <span>UP: ${escapeHtml(v.author || "-")}</span>
          <span>分P: ${v.pageCount}${v.pageCount > 1 ? ' <span class="page-tag">多P</span>' : ""}</span>
        </div>
        ${v.error ? `<div class="error-detail">${escapeHtml(v.error)}</div>` : ""}
      </div>
      <div class="video-actions">
        <button class="choice-btn ${v.choice === "A" ? "active" : ""}" data-bvid="${escapeHtml(v.bvid)}" data-choice="A" ${state.isRunning ? "disabled" : ""}>A 单P</button>
        <button class="choice-btn ${v.choice === "B" ? "active" : ""}" data-bvid="${escapeHtml(v.bvid)}" data-choice="B" ${v.pageCount <= 1 || state.isRunning ? "disabled" : ""}>B 全P</button>
      </div>
      <div class="video-status" data-bvid="${escapeHtml(v.bvid)}"></div>
    </div>
  `).join("");

  // 绑定事件
  container.querySelectorAll(".video-checkbox input").forEach(cb => {
    cb.addEventListener("change", (e) => {
      const bvid = e.target.dataset.bvid;
      const video = state.videos.find(v => v.bvid === bvid);
      if (video) video.selected = e.target.checked;
    });
  });

  container.querySelectorAll(".choice-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const bvid = e.target.dataset.bvid;
      const choice = e.target.dataset.choice;
      onChoiceChange(bvid, choice);
    });
  });
}

function onChoiceChange(bvid, choice) {
  const video = state.videos.find(v => v.bvid === bvid);
  if (!video) return;
  video.choice = choice;
  renderVideoList();
}

function selectAll(choice) {
  for (const v of state.videos) {
    if (v.pageCount > 1) {
      v.choice = choice;
    } else {
      v.choice = "A";
    }
    v.selected = true;
  }
  renderVideoList();
}

function onAutoSelectBChange(e) {
  if (state.videos.length === 0) return;
  for (const v of state.videos) {
    if (v.pageCount > 1 && !v.choice) {
      v.choice = e.target.checked ? "B" : null;
    }
  }
  renderVideoList();
}

function updateVideoStatus(bvid, status, message) {
  const el = document.querySelector(`.video-status[data-bvid="${CSS.escape(bvid)}"]`);
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
  document.getElementById("selectAllABtn").disabled = disabled;
  document.getElementById("selectAllBBtn").disabled = disabled;
  document.getElementById("startBtn").disabled = disabled;
  document.getElementById("formatSelect").disabled = disabled;
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

function extractBvid(url) {
  const match = url.match(/\/video\/(BV[0-9A-Za-z]+)/);
  if (match?.[1]) return match[1];
  try {
    const fromQuery = String(new URL(url).searchParams.get("bvid") || "").trim();
    if (/^BV[0-9A-Za-z]+$/.test(fromQuery)) return fromQuery;
  } catch {}
  return "";
}

function normalizeSubtitleUrl(url) {
  const text = String(url || "").trim();
  if (!text) return "";
  if (text.startsWith("//")) return `https:${text}`;
  if (!text.startsWith("http://") && !text.startsWith("https://")) {
    return `https://${text.replace(/^\/+/, "")}`;
  }
  return text;
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
  const min = m % 60;
  if (h > 0) {
    return `${h}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatSrtTime(seconds) {
  const ms = Math.floor((seconds % 1) * 1000);
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function getErrorMessage(error, fallback = "未知错误") {
  const msg = String(error?.message || error || "").trim();
  return msg || fallback;
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

// ============ 启动 ============

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
