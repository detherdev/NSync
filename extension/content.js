/**
 * NSync — Content Script
 *
 * Injected into every page. Detects the primary <video>/<audio> element,
 * listens for local playback events, applies remote sync commands,
 * and shows on-screen toast notifications for peer actions.
 */

(() => {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────
  let mediaElement = null;
  let remoteLock = false; // prevents echo when applying remote commands
  const SEEK_THRESHOLD = 1.5; // seconds — ignore minor time drifts

  // ── Toast notification system ──────────────────────────────────────

  let toastContainer = null;

  function getToastContainer() {
    if (toastContainer && document.body.contains(toastContainer)) {
      return toastContainer;
    }

    toastContainer = document.createElement("div");
    toastContainer.id = "nsync-toast-container";

    // Styles injected inline to avoid conflicts with page CSS
    Object.assign(toastContainer.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: "2147483647",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      pointerEvents: "none",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    });

    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  function formatTime(seconds) {
    if (seconds == null || isNaN(seconds)) return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function getEventIcon(event) {
    switch (event) {
      case "play":
        return "▶";
      case "pause":
        return "⏸";
      case "seek":
        return "⏩";
      case "url":
        return "🔗";
      default:
        return "🔔";
    }
  }

  function getEventLabel(event) {
    switch (event) {
      case "play":
        return "played";
      case "pause":
        return "paused";
      case "seek":
        return "seeked to";
      case "url":
        return "navigated";
      default:
        return event;
    }
  }

  function showToast(event, time, extra) {
    const container = getToastContainer();

    // Clear any existing toasts — only show the latest
    while (container.firstChild) {
      container.firstChild.remove();
    }

    const toast = document.createElement("div");
    Object.assign(toast.style, {
      background: "rgba(15, 15, 20, 0.55)",
      backdropFilter: "blur(16px)",
      WebkitBackdropFilter: "blur(16px)",
      border: "1px solid rgba(124, 92, 252, 0.2)",
      borderRadius: "10px",
      padding: "10px 16px",
      color: "rgba(232, 232, 239, 0.9)",
      fontSize: "13px",
      fontWeight: "500",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      boxShadow: "0 4px 24px rgba(0, 0, 0, 0.3)",
      opacity: "0",
      transform: "translateX(20px)",
      transition: "all 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
      pointerEvents: "auto",
      maxWidth: "320px",
    });

    const icon = getEventIcon(event);
    const label = getEventLabel(event);

    let detail = "";
    if (event === "url" && extra) {
      try {
        const url = new URL(extra);
        detail = url.hostname + url.pathname;
        if (detail.length > 40) detail = detail.substring(0, 37) + "…";
      } catch {
        detail = extra;
      }
    } else if (time != null) {
      detail = formatTime(time);
    }

    toast.innerHTML = `
      <span style="font-size:16px;flex-shrink:0">${icon}</span>
      <span>
        <span style="color:#9478ff;font-weight:600">Peer</span>
        ${label}
        ${detail ? `<span style="color:#9478ff;font-weight:600;margin-left:2px">${detail}</span>` : ""}
      </span>
    `;

    container.appendChild(toast);

    // Animate in (slow fade)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateX(0)";
      });
    });

    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(20px)";
      setTimeout(() => toast.remove(), 600);
    }, 3000);
  }

  // ── Media element detection ────────────────────────────────────────

  /**
   * Find the best candidate media element on the page.
   * Prefers the largest visible <video>, falls back to <audio>.
   */
  function findMediaElement() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length > 0) {
      // Pick the largest by area (handles YouTube's multiple <video> tags)
      return videos.reduce((best, v) => {
        const area = v.clientWidth * v.clientHeight;
        const bestArea = best.clientWidth * best.clientHeight;
        return area > bestArea ? v : best;
      });
    }

    const audios = Array.from(document.querySelectorAll("audio"));
    if (audios.length > 0) return audios[0];

    return null;
  }

  // ── Local event handlers ───────────────────────────────────────────

  function onPlay() {
    if (remoteLock) return;
    console.log("[NSync] Local play at", mediaElement.currentTime);
    sendMediaEvent("play", mediaElement.currentTime);
  }

  function onPause() {
    if (remoteLock) return;
    console.log("[NSync] Local pause at", mediaElement.currentTime);
    sendMediaEvent("pause", mediaElement.currentTime);
  }

  function onSeeked() {
    if (remoteLock) return;
    console.log("[NSync] Local seek to", mediaElement.currentTime);
    sendMediaEvent("seek", mediaElement.currentTime);
  }

  function sendMediaEvent(event, time) {
    chrome.runtime.sendMessage({
      type: "MEDIA_EVENT",
      event,
      time,
    });
  }

  // ── Remote command handlers ────────────────────────────────────────

  function applyRemoteCommand(event, time) {
    if (!mediaElement) {
      console.warn("[NSync] Remote command received but no media element found");
      return;
    }

    console.log("[NSync] Applying remote command:", event, "time:", time);
    remoteLock = true;

    // Show toast notification
    showToast(event, time);

    switch (event) {
      case "play":
        mediaElement.currentTime = time;
        mediaElement.play().catch((err) => {
          console.warn("[NSync] play() blocked:", err.message);
        });
        break;
      case "pause":
        mediaElement.currentTime = time;
        mediaElement.pause();
        break;
      case "seek":
        mediaElement.currentTime = time;
        break;
    }

    // Release lock after a short delay so local events settle
    setTimeout(() => {
      remoteLock = false;
    }, 500);
  }

  // ── Attach / detach listeners ──────────────────────────────────────

  function attachListeners(el) {
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("seeked", onSeeked);
  }

  function detachListeners(el) {
    el.removeEventListener("play", onPlay);
    el.removeEventListener("pause", onPause);
    el.removeEventListener("seeked", onSeeked);
  }

  // ── Listen for messages from the service worker ────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "REMOTE_COMMAND") {
      applyRemoteCommand(message.event, message.time);
      sendResponse({ ok: true });
    }

    if (message.type === "REMOTE_URL") {
      // Show toast about navigation, then navigate
      console.log("[NSync] Remote URL change:", message.url);
      showToast("url", null, message.url);
      setTimeout(() => {
        window.location.href = message.url;
      }, 800); // short delay so user sees the toast
      sendResponse({ ok: true });
    }

    if (message.type === "PING_CONTENT") {
      // The popup/background can ping to check if a media element exists
      sendResponse({ hasMedia: !!mediaElement });
    }
  });

  // ── Initialization ─────────────────────────────────────────────────

  /**
   * Observe the DOM for dynamically-added media elements
   * (YouTube loads <video> after initial page load).
   */
  function registerMedia(el) {
    if (mediaElement) detachListeners(mediaElement);
    mediaElement = el;
    attachListeners(mediaElement);
    console.log("[NSync] Media element found and registered");
    // Tell the background service worker about this tab
    chrome.runtime.sendMessage({ type: "REGISTER_MEDIA" }).catch(() => {});
  }

  function init() {
    // Try immediately
    const el = findMediaElement();
    if (el) {
      registerMedia(el);
    }

    // Watch for mutations (SPAs, lazy-loaded players)
    const observer = new MutationObserver(() => {
      const el = findMediaElement();
      if (el && el !== mediaElement) {
        registerMedia(el);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Periodic fallback scan — catches edge cases where YouTube
    // loads the <video> without triggering a mutation we observe
    const scanInterval = setInterval(() => {
      const el = findMediaElement();
      if (el && el !== mediaElement) {
        registerMedia(el);
      }
      // Stop scanning once we've found something
      if (mediaElement) clearInterval(scanInterval);
    }, 1000);

    // Stop scanning after 30s regardless
    setTimeout(() => clearInterval(scanInterval), 30000);
  }

  // Wait for body to be ready
  if (document.body) {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
