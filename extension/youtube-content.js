/**
 * YouTube 内容脚本 — 注入到 youtube.com/watch 页面
 * 功能：读取 ytInitialPlayerResponse 获取视频元数据和字幕轨道，响应批量下载请求
 */

(function () {
  "use strict";

  const YTC_VERSION = "1.0.1";
  const state = {
    videoId: "",
    title: "",
    channel: "",
    duration: 0,
    captionTracks: [],
    translationLanguages: [],
    subtitleBody: [],
    selectedTrack: null,
    extracted: false
  };
  let pollTimer = null;

  function init() {
    bindRuntimeEvents();
    registerTab();
    startDataPolling();
    bindSpaNavigation();
    console.info(`[YTC] YouTube content script loaded, version=${YTC_VERSION}`);
  }

  /* ---------- 轮询等待 ytInitialPlayerResponse ---------- */
  function startDataPolling() {
    if (pollTimer) clearInterval(pollTimer);
    let attempts = 0;
    const maxAttempts = 40; // 最多等 20 秒

    function tryExtract() {
      attempts++;
      const ytp = getYtInitialPlayerResponse();
      if (ytp) {
        extractPageData(ytp);
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        return;
      }
      if (attempts >= maxAttempts) {
        console.warn("[YTC] ytInitialPlayerResponse still not found after", maxAttempts, "attempts");
        // 兜底：从 URL 提取视频 ID
        const vid = extractVideoIdFromUrl(location.href);
        if (vid && !state.videoId) {
          state.videoId = vid;
          state.title = document.title || "";
          state.url = location.href;
          console.info("[YTC] fallback: extracted videoId from URL", vid);
        }
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    tryExtract(); // 立即试一次
    pollTimer = setInterval(tryExtract, 500);
  }

  /* ---------- 获取 ytInitialPlayerResponse（多途径） ---------- */
  function getYtInitialPlayerResponse() {
    // 1. window 对象
    if (window.ytInitialPlayerResponse) {
      return window.ytInitialPlayerResponse;
    }
    // 2. ytplayer 对象
    if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args && window.ytplayer.config.args.raw_player_response) {
      return window.ytplayer.config.args.raw_player_response;
    }
    // 3. 从 DOM script 标签解析
    const fromDom = parseYtInitialPlayerResponseFromDom();
    if (fromDom) return fromDom;
    // 4. 从 ytCfg / ytcfg
    try {
      if (window.ytcfg && window.ytcfg.get) {
        const cfg = window.ytcfg.get("PLAYER_CONFIG");
        if (cfg && cfg.args && cfg.args.raw_player_response) {
          return cfg.args.raw_player_response;
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function parseYtInitialPlayerResponseFromDom() {
    try {
      const scripts = document.querySelectorAll("script");
      for (const script of scripts) {
        const text = script.textContent || "";
        if (text.includes("ytInitialPlayerResponse")) {
          // 匹配 var ytInitialPlayerResponse = {...};
          const match = text.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/);
          if (match) {
            try {
              return JSON.parse(match[1]);
            } catch (e) {
              // 可能是嵌套 JSON，尝试用更安全的方式
            }
          }
          // 匹配 window["ytInitialPlayerResponse"] = {...};
          const match2 = text.match(/window\["?ytInitialPlayerResponse"?\]\s*=\s*(\{[\s\S]*?\});/);
          if (match2) {
            try {
              return JSON.parse(match2[1]);
            } catch (e) { /* ignore */ }
          }
        }
      }
    } catch (e) {
      console.warn("[YTC] parseYtInitialPlayerResponseFromDom failed:", e);
    }
    return null;
  }

  /* ---------- SPA 导航监听 ---------- */
  function bindSpaNavigation() {
    // YouTube 自定义导航事件
    const navEvents = ["yt-navigate-finish", "yt-page-data-updated", "spfdone"];
    for (const evt of navEvents) {
      document.addEventListener(evt, () => {
        console.info("[YTC] SPA navigation detected:", evt);
        state.extracted = false;
        startDataPolling();
      });
    }
    // URL 变化监听（MutationObserver on title 或 history pushState）
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.info("[YTC] URL changed to:", lastUrl);
        state.extracted = false;
        startDataPolling();
      }
    }).observe(document.querySelector("title") || document.documentElement, { childList: true, subtree: true });
  }

  /* ---------- Tab 注册 ---------- */
  function registerTab() {
    try {
      chrome.runtime.sendMessage({
        type: "yt-register-tab",
        tabId: -1,
        url: location.href,
        title: document.title
      }, (resp) => {
        if (chrome.runtime.lastError) {
          console.warn("[YTC] register tab failed:", chrome.runtime.lastError.message);
          return;
        }
        console.info("[YTC] tab registered:", resp);
      });
    } catch (e) {
      console.warn("[YTC] register tab exception:", e);
    }

    window.addEventListener("beforeunload", () => {
      try {
        chrome.runtime.sendMessage({ type: "yt-unregister-tab", tabId: -1 });
      } catch (e) { /* ignore */ }
    });
  }

  /* ---------- 数据提取 ---------- */
  function extractPageData(ytp) {
    if (state.extracted) return;
    try {
      const vd = ytp.videoDetails || {};
      state.videoId = vd.videoId || extractVideoIdFromUrl(location.href) || "";
      state.title = vd.title || document.title || "";
      state.channel = vd.author || "";
      state.duration = Number(vd.lengthSeconds || 0);

      // 提取字幕轨道
      const captionData = ytp.captions?.playerCaptionsTracklistRenderer;
      if (captionData) {
        const rawTracks = captionData.captionTracks || [];
        state.captionTracks = rawTracks.map(t => {
          // YouTube 有时会改字段名，兼容 baseUrl / url
          const url = t.baseUrl || t.url || "";
          return {
            baseUrl: url,
            name: t.name?.simpleText || t.name?.runs?.[0]?.text || "",
            languageCode: t.languageCode || "",
            kind: t.kind || "",
            isTranslatable: t.isTranslatable || false
          };
        });
        state.translationLanguages = (captionData.translationLanguages || []).map(t => ({
          languageCode: t.languageCode || "",
          languageName: t.languageName?.simpleText || ""
        }));
        // 调试：检查是否有 track 缺少 URL
        const missingUrl = state.captionTracks.filter(t => !t.baseUrl);
        if (missingUrl.length > 0) {
          console.warn("[YTC] tracks missing baseUrl:", missingUrl.length, "of", state.captionTracks.length);
        }
        // 默认语言：第一个 caption track 的语言（通常是视频原语言）
        state.defaultLanguage = state.captionTracks[0]?.languageCode || "";
      } else {
        state.captionTracks = [];
        state.translationLanguages = [];
        state.defaultLanguage = "";
      }

      state.extracted = true;
      console.info("[YTC] extracted page data", {
        videoId: state.videoId,
        title: state.title,
        tracks: state.captionTracks.length,
        hasCaptions: !!captionData
      });
    } catch (error) {
      console.error("[YTC] extractPageData failed", error);
    }
  }

  function extractVideoIdFromUrl(url) {
    try {
      const u = new URL(url);
      if (u.hostname === "youtu.be") return u.pathname.slice(1);
      return u.searchParams.get("v") || "";
    } catch {
      return "";
    }
  }

  /* ---------- 消息处理 ---------- */
  function bindRuntimeEvents() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== "object") return false;

      if (message.type === "ytc-get-info") {
        // 如果还没提取到，先尝试一次
        if (!state.extracted) {
          const ytp = getYtInitialPlayerResponse();
          if (ytp) extractPageData(ytp);
        }
        sendResponse({
          ok: true,
          data: {
            videoId: state.videoId,
            title: state.title,
            channel: state.channel,
            duration: state.duration,
            url: location.href,
            trackCount: state.captionTracks.length,
            defaultLanguage: state.defaultLanguage,
            tracks: state.captionTracks.map(t => ({
              baseUrl: t.baseUrl,
              name: t.name,
              languageCode: t.languageCode,
              kind: t.kind,
              isTranslatable: t.isTranslatable
            }))
          }
        });
        return false;
      }

      if (message.type === "ytc-fetch-subtitle") {
        const url = message.url;
        if (!url) {
          sendResponse({ ok: false, error: "Missing subtitle URL" });
          return false;
        }
        fetchSubtitleContent(url)
          .then(body => sendResponse({ ok: true, body }))
          .catch(error => sendResponse({ ok: false, error: getErrorMessage(error) }));
        return true;
      }

      if (message.type === "ytc-fetch-translation") {
        const baseUrl = message.baseUrl;
        const lang = message.lang;
        if (!baseUrl || !lang) {
          sendResponse({ ok: false, error: "Missing params" });
          return false;
        }
        const translateUrl = addTranslationParam(baseUrl, lang);
        fetchSubtitleContent(translateUrl)
          .then(body => sendResponse({ ok: true, body, languageCode: lang }))
          .catch(error => sendResponse({ ok: false, error: getErrorMessage(error) }));
        return true;
      }

      return false;
    });
  }

  /* ---------- 字幕获取 ---------- */
  async function fetchSubtitleContent(url) {
    // YouTube baseUrl 默认格式不稳定，依次尝试 srv3 JSON / ttml XML / vtt
    const formats = [
      { fmt: "srv3", parser: "json" },
      { fmt: "ttml", parser: "xml" },
      { fmt: "vtt",  parser: "vtt" }
    ];

    for (const { fmt, parser } of formats) {
      try {
        const tryUrl = addFormatParam(url, fmt);
        console.log(`[YTC] fetching subtitle, fmt=${fmt}:`, tryUrl.slice(0, 120));
        const resp = await fetch(tryUrl, {
          credentials: "include",
          headers: { Accept: "*/*" }
        });
        if (!resp.ok) {
          console.warn(`[YTC] fmt=${fmt} HTTP ${resp.status}`);
          continue;
        }
        const text = await resp.text();
        console.log(`[YTC] fmt=${fmt} response length=${text.length}, preview:`, text.slice(0, 300));

        let body = [];
        if (parser === "json") {
          try {
            const json = JSON.parse(text);
            if (json.events || json.pens) body = parseSrv3Json(json);
          } catch { /* not JSON */ }
        } else if (parser === "xml") {
          body = parseXmlSubtitle(text);
        } else if (parser === "vtt") {
          body = parseVttSubtitle(text);
        }

        console.log(`[YTC] fmt=${fmt} parsed ${body.length} lines`);
        if (body.length > 0) return body;
      } catch (e) {
        console.warn(`[YTC] fmt=${fmt} failed:`, getErrorMessage(e));
      }
    }

    // Fallback: baseUrl 签名可能已过期，用最简参数构造 URL 重试
    try {
      const lang = extractLangFromUrl(url);
      if (state.videoId && lang) {
        const simpleUrl = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(state.videoId)}&lang=${encodeURIComponent(lang)}&fmt=srv3`;
        console.log(`[YTC] fallback simple URL:`, simpleUrl);
        const resp = await fetch(simpleUrl, { credentials: "include", headers: { Accept: "*/*" } });
        if (resp.ok) {
          const text = await resp.text();
          console.log(`[YTC] fallback response length=${text.length}`);
          try {
            const json = JSON.parse(text);
            if (json.events || json.pens) {
              const body = parseSrv3Json(json);
              if (body.length > 0) return body;
            }
          } catch { /* not JSON */ }
          const body = parseXmlSubtitle(text);
          if (body.length > 0) return body;
        }
      }
    } catch (e) {
      console.warn("[YTC] fallback failed:", getErrorMessage(e));
    }

    throw new Error("所有格式均未解析出字幕内容");
  }

  function addFormatParam(baseUrl, fmt) {
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", fmt);
    return url.toString();
  }

  function extractLangFromUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      return u.searchParams.get("lang") || "";
    } catch {
      return "";
    }
  }

  function parseSrv3Json(data) {
    const events = data.events || [];
    const body = [];
    for (const event of events) {
      const tStartMs = event.tStartMs || 0;
      const dDurationMs = event.dDurationMs || 5000;
      const segs = event.segs || [];
      let text = "";
      for (const seg of segs) {
        if (seg.utf8) text += seg.utf8;
      }
      text = text.replace(/\n/g, " ").trim();
      if (!text) continue;
      body.push({ from: tStartMs / 1000, to: (tStartMs + dDurationMs) / 1000, content: text });
    }
    return body;
  }

  function parseXmlSubtitle(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");

    // YouTube XML 字幕用 <p> 标签（t=开始时间ms, d=持续时间ms）
    // 旧版 API 用 <text> 标签（start=秒, dur=秒）
    let nodes = doc.querySelectorAll("p");
    if (nodes.length === 0) {
      nodes = doc.querySelectorAll("text");
    }

    const body = [];
    for (const node of nodes) {
      // <p t="1000" d="3000"> 或 <text start="1.0" dur="5">
      const tMs = node.getAttribute("t");
      const dMs = node.getAttribute("d");
      const startSec = node.getAttribute("start");
      const durSec = node.getAttribute("dur");

      let start, dur;
      if (tMs !== null) {
        start = Number(tMs) / 1000;
        dur = Number(dMs || 5000) / 1000;
      } else {
        start = Number(startSec || 0);
        dur = Number(durSec || 5);
      }

      let content = "";
      for (const child of node.childNodes) {
        content += child.textContent || "";
      }
      content = content.replace(/\n/g, " ").trim();
      if (!content) continue;
      body.push({ from: start, to: start + dur, content });
    }
    return body;
  }

  function parseVttSubtitle(vttText) {
    const body = [];
    const lines = vttText.split("\n");
    let i = 0;
    // 跳过 WEBVTT 头和空行
    while (i < lines.length && (lines[i].trim() === "" || lines[i].startsWith("WEBVTT") || lines[i].includes("-->"))) {
      i++;
    }
    while (i < lines.length) {
      // 跳过序号行
      if (/^\d+$/.test(lines[i].trim())) i++;
      if (i >= lines.length) break;
      // 时间行: 00:00:01.000 --> 00:00:05.000
      const timeLine = lines[i].trim();
      const timeMatch = timeLine.match(/([\d:.]+)\s+-->\s+([\d:.]+)/);
      if (!timeMatch) { i++; continue; }
      const from = parseVttTime(timeMatch[1]);
      const to = parseVttTime(timeMatch[2]);
      i++;
      // 收集内容行（可能多行）
      const contentLines = [];
      while (i < lines.length && lines[i].trim() !== "" && !lines[i].includes("-->")) {
        contentLines.push(lines[i].trim());
        i++;
      }
      const content = contentLines.join(" ").trim();
      if (content) body.push({ from, to, content });
      // 跳过空行
      while (i < lines.length && lines[i].trim() === "") i++;
    }
    return body;
  }

  function parseVttTime(timeStr) {
    // 00:00:01.000 或 00:01.000
    const parts = timeStr.split(":");
    if (parts.length === 3) {
      return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
    } else if (parts.length === 2) {
      return Number(parts[0]) * 60 + Number(parts[1]);
    }
    return Number(timeStr) || 0;
  }

  function addTranslationParam(baseUrl, lang) {
    const url = new URL(baseUrl);
    url.searchParams.set("tlang", lang);
    return url.toString();
  }

  function getErrorMessage(error, fallback = "未知错误") {
    return String(error?.message || error || "").trim() || fallback;
  }

  init();
})();
