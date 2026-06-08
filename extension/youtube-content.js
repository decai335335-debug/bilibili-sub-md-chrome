/**
 * YouTube 内容脚本 — 注入到 youtube.com/watch 页面
 * 功能：读取 ytInitialPlayerResponse 获取视频元数据和字幕轨道，响应批量下载请求
 * 字幕获取逻辑参考 youtube-transcript-api（Python）：移除 fmt=srv3，直接 GET baseUrl，解析 XML
 */

(function () {
  "use strict";

  const YTC_VERSION = "1.0.2";
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
    const maxAttempts = 40;

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

    tryExtract();
    pollTimer = setInterval(tryExtract, 500);
  }

  /* ---------- 获取 ytInitialPlayerResponse（多途径） ---------- */
  function getYtInitialPlayerResponse() {
    if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
    if (window.ytplayer?.config?.args?.raw_player_response) return window.ytplayer.config.args.raw_player_response;
    const fromDom = parseYtInitialPlayerResponseFromDom();
    if (fromDom) return fromDom;
    try {
      if (window.ytcfg?.get) {
        const cfg = window.ytcfg.get("PLAYER_CONFIG");
        if (cfg?.args?.raw_player_response) return cfg.args.raw_player_response;
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
          const m1 = text.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/);
          if (m1) { try { return JSON.parse(m1[1]); } catch (e) {} }
          const m2 = text.match(/window\["?ytInitialPlayerResponse"?\]\s*=\s*(\{[\s\S]*?\});/);
          if (m2) { try { return JSON.parse(m2[1]); } catch (e) {} }
        }
      }
    } catch (e) {
      console.warn("[YTC] parseYtInitialPlayerResponseFromDom failed:", e);
    }
    return null;
  }

  /* ---------- SPA 导航监听 ---------- */
  function bindSpaNavigation() {
    const navEvents = ["yt-navigate-finish", "yt-page-data-updated", "spfdone"];
    for (const evt of navEvents) {
      document.addEventListener(evt, () => {
        console.info("[YTC] SPA navigation detected:", evt);
        state.extracted = false;
        startDataPolling();
      });
    }
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
      try { chrome.runtime.sendMessage({ type: "yt-unregister-tab", tabId: -1 }); } catch (e) {}
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

      const captionData = ytp.captions?.playerCaptionsTracklistRenderer;
      if (captionData) {
        const rawTracks = captionData.captionTracks || [];
        state.captionTracks = rawTracks.map(t => ({
          baseUrl: cleanBaseUrl(t.baseUrl || t.url || ""),
          name: t.name?.simpleText || t.name?.runs?.[0]?.text || "",
          languageCode: t.languageCode || "",
          kind: t.kind || "",
          isTranslatable: t.isTranslatable || false
        }));
        state.translationLanguages = (captionData.translationLanguages || []).map(t => ({
          languageCode: t.languageCode || "",
          languageName: t.languageName?.simpleText || ""
        }));
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

  // youtube-transcript-api 的做法：移除 &fmt=srv3，让 YouTube 返回默认 XML
  function cleanBaseUrl(url) {
    if (!url) return "";
    try {
      const u = new URL(url);
      u.searchParams.delete("fmt");
      return u.toString();
    } catch {
      return url;
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

  /* ---------- 字幕获取（完全模仿 youtube-transcript-api） ---------- */
  async function fetchSubtitleContent(url) {
    console.log("[YTC] fetching subtitle XML:", url.slice(0, 120));
    const resp = await fetch(url, {
      credentials: "include",
      headers: { "Accept-Language": "en-US", Accept: "*/*" }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    console.log("[YTC] response length=", text.length, "preview:", text.slice(0, 400));

    const body = parseTranscriptXml(text);
    console.log("[YTC] parsed", body.length, "lines");
    if (body.length === 0) throw new Error("字幕内容为空");
    return body;
  }

  // 模仿 youtube-transcript-api 的 _TranscriptParser
  // YouTube 返回: <transcript><text start="1.0" dur="5.0">Hello</text>...</transcript>
  function parseTranscriptXml(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const nodes = doc.documentElement.childNodes;
    const body = [];
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const start = Number(node.getAttribute("start") || 0);
      const dur = Number(node.getAttribute("dur") || 0);
      let text = "";
      // 收集所有文本内容（包括子元素中的文本）
      for (const child of node.childNodes) {
        text += child.textContent || "";
      }
      // 清理 HTML 标签（如 <b>, <i>）
      text = text.replace(/<[^>]*>/g, "").trim();
      // 解码 HTML 实体
      const textarea = document.createElement("textarea");
      textarea.innerHTML = text;
      text = textarea.value;
      if (!text) continue;
      body.push({ from: start, to: start + dur, content: text });
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
