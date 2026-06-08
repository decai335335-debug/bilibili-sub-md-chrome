/**
 * YouTube 内容脚本 — 注入到 youtube.com/watch 页面
 * 功能：读取 ytInitialPlayerResponse 获取视频元数据和字幕轨道，响应批量下载请求
 */

(function () {
  "use strict";

  const YTC_VERSION = "1.0.0";
  const state = {
    videoId: "",
    title: "",
    channel: "",
    duration: 0,
    captionTracks: [],
    translationLanguages: [],
    subtitleBody: [],
    selectedTrack: null
  };

  function init() {
    extractPageData();
    bindRuntimeEvents();
    registerTab();
    console.info(`[YTC] YouTube content script loaded, version=${YTC_VERSION}`);
  }

  function registerTab() {
    try {
      chrome.runtime.sendMessage({
        type: "yt-register-tab",
        tabId: -1, // background.js 会通过 sender.tab.id 获取
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

    // 页面卸载时注销
    window.addEventListener("beforeunload", () => {
      try {
        chrome.runtime.sendMessage({
          type: "yt-unregister-tab",
          tabId: -1
        });
      } catch (e) {
        // ignore
      }
    });
  }

  function extractPageData() {
    try {
      // 从 ytInitialPlayerResponse 提取视频信息
      const ytp = window.ytInitialPlayerResponse;
      if (!ytp) {
        console.warn("[YTC] ytInitialPlayerResponse not found");
        return;
      }

      const vd = ytp.videoDetails || {};
      state.videoId = vd.videoId || "";
      state.title = vd.title || "";
      state.channel = vd.author || "";
      state.duration = Number(vd.lengthSeconds || 0);

      // 提取字幕轨道
      const captionData = ytp.captions?.playerCaptionsTracklistRenderer;
      if (captionData) {
        state.captionTracks = (captionData.captionTracks || []).map(t => ({
          baseUrl: t.baseUrl || "",
          name: t.name?.simpleText || t.name?.runs?.[0]?.text || "",
          languageCode: t.languageCode || "",
          kind: t.kind || "", // "asr" = 自动生成
          isTranslatable: t.isTranslatable || false
        }));
        state.translationLanguages = (captionData.translationLanguages || []).map(t => ({
          languageCode: t.languageCode || "",
          languageName: t.languageName?.simpleText || ""
        }));
      }

      console.info("[YTC] extracted page data", {
        videoId: state.videoId,
        title: state.title,
        tracks: state.captionTracks.length
      });
    } catch (error) {
      console.error("[YTC] extractPageData failed", error);
    }
  }

  function bindRuntimeEvents() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== "object") {
        return false;
      }

      // 获取当前页面视频信息（用于批量扫描）
      if (message.type === "ytc-get-info") {
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
              name: t.name,
              languageCode: t.languageCode,
              kind: t.kind,
              isTranslatable: t.isTranslatable
            }))
          }
        });
        return false;
      }

      // 获取指定字幕的内容
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

      // 获取翻译字幕
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

  async function fetchSubtitleContent(url) {
    const resp = await fetch(url, {
      credentials: "include",
      headers: {
        Accept: "*/*"
      }
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const text = await resp.text();

    // YouTube 字幕可能是 JSON（srv3）或 XML（ttml）
    // 优先尝试 JSON
    try {
      const json = JSON.parse(text);
      if (json.events || json.pens) {
        return parseSrv3Json(json);
      }
    } catch {
      // 不是 JSON，尝试 XML
    }

    // 尝试解析 XML
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
        if (seg.utf8) {
          text += seg.utf8;
        }
      }

      text = text.replace(/\n/g, " ").trim();
      if (!text) continue;

      body.push({
        from: tStartMs / 1000,
        to: (tStartMs + dDurationMs) / 1000,
        content: text
      });
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

      // 处理 <text> 内容（可能包含 <s> 标签）
      const children = node.childNodes;
      for (const child of children) {
        if (child.nodeType === Node.TEXT_NODE) {
          content += child.textContent;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          content += child.textContent;
        }
      }

      content = content.replace(/\n/g, " ").trim();
      if (!content) continue;

      body.push({
        from: start,
        to: start + dur,
        content
      });
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
