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
        state.captionTracks = (captionData.captionTracks || []).map(t => ({
          baseUrl: t.baseUrl || "",
          name: t.name?.simpleText || t.name?.runs?.[0]?.text || "",
          languageCode: t.languageCode || "",
          kind: t.kind || "",
          isTranslatable: t.isTranslatable || false
        }));
        state.translationLanguages = (captionData.translationLanguages || []).map(t => ({
          languageCode: t.languageCode || "",
          languageName: t.languageName?.simpleText || ""
        }));
      } else {
        state.captionTracks = [];
        state.translationLanguages = [];
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
    const resp = await fetch(url, {
      credentials: "include",
      headers: { Accept: "*/*" }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();

    try {
      const json = JSON.parse(text);
      if (json.events || json.pens) return parseSrv3Json(json);
    } catch { /* not JSON */ }

    return parseXmlSubtitle(text);
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
    const texts = doc.querySelectorAll("text");
    const body = [];
    for (const node of texts) {
      const start = Number(node.getAttribute("start") || 0);
      const dur = Number(node.getAttribute("dur") || 5);
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
