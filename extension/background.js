/**
 * Play inSync — Service Worker (Background)
 *
 * Maintains the WebSocket connection to the signaling server,
 * relays messages between content scripts and the server,
 * and manages room state.
 */

"use strict";

// ── Configuration ────────────────────────────────────────────────────
const DEFAULT_SERVER_URL = "wss://nsync.onrender.com";

// ── State ────────────────────────────────────────────────────────────
let ws = null;
let roomCode = null;
let serverUrl = DEFAULT_SERVER_URL;
let keepAliveInterval = null;
let mediaTabId = null; // tracks which tab has the active media element
let urlSyncLock = false; // prevents echo when navigating from remote URL

// ── Ensure content script is injected ────────────────────────────────

async function ensureContentScript(tabId) {
  if (!tabId) return;
  try {
    // Try pinging the content script first
    const response = await chrome.tabs.sendMessage(tabId, { type: "PING_CONTENT" });
    if (response) {
      console.log("[inSync] Content script already active on tab", tabId);
      return;
    }
  } catch {
    // Content script not running — inject it
    console.log("[inSync] Injecting content script into tab", tabId);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      console.log("[inSync] Content script injected successfully");
    } catch (err) {
      console.error("[inSync] Failed to inject content script:", err.message);
    }
  }
}

async function injectIntoActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    for (const tab of tabs) {
      if (tab.id && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
        await ensureContentScript(tab.id);
      }
    }
  } catch (err) {
    console.error("[inSync] Error injecting into active tab:", err);
  }
}

// ── WebSocket lifecycle ──────────────────────────────────────────────

function connect(url) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  serverUrl = url || serverUrl;
  ws = new WebSocket(serverUrl);

  ws.addEventListener("open", () => {
    console.log("[inSync] Connected to server");
    broadcastState();
    startKeepAlive();
  });

  ws.addEventListener("message", (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    handleServerMessage(data);
  });

  ws.addEventListener("close", () => {
    console.log("[inSync] Disconnected from server");
    stopKeepAlive();
    roomCode = null;
    broadcastState();
  });

  ws.addEventListener("error", (err) => {
    console.error("[inSync] WebSocket error:", err);
  });
}

function disconnect() {
  if (ws) {
    ws.close();
    ws = null;
  }
  roomCode = null;
  stopKeepAlive();
  broadcastState();
}

// ── Keep-alive ping (prevents MV3 service worker from sleeping) ─────

function startKeepAlive() {
  stopKeepAlive();
  keepAliveInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "PING" }));
    }
  }, 25000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// ── Server message handling ──────────────────────────────────────────

function handleServerMessage(data) {
  switch (data.type) {
    case "ROOM_CREATED":
      roomCode = data.code;
      chrome.storage.session.set({ roomCode, connected: true });
      broadcastState();
      break;

    case "ROOM_JOINED":
      roomCode = data.code;
      chrome.storage.session.set({ roomCode, connected: true, peerCount: data.peerCount });
      broadcastState();
      break;

    case "PEER_JOINED":
    case "PEER_LEFT":
      chrome.storage.session.set({ peerCount: data.peerCount });
      broadcastState();
      break;

    case "MEDIA_EVENT":
      // Forward to content script(s)
      console.log("[inSync] Received remote event:", data.event, "time:", data.time);
      forwardToContentScript({
        type: "REMOTE_COMMAND",
        event: data.event,
        time: data.time,
      });
      break;

    case "URL_CHANGE":
      // Peer navigated to a new URL — navigate our tab to match
      console.log("[inSync] Received remote URL change:", data.url);
      navigateToUrl(data.url);
      break;

    case "ERROR":
      console.error("[inSync] Server error:", data.message);
      broadcastState({ error: data.message });
      break;

    case "PONG":
      // Keep-alive response, nothing to do
      break;
  }
}

// ── Send to server ───────────────────────────────────────────────────

function sendToServer(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// ── Forward remote commands to the tab with media ───────────────────

async function forwardToContentScript(message) {
  try {
    // If we know which tab has media, send directly there
    if (mediaTabId != null) {
      try {
        await chrome.tabs.sendMessage(mediaTabId, message);
        console.log("[inSync] Sent command to tracked media tab:", mediaTabId);
        return;
      } catch {
        // Tab may have closed — fall through to broadcast
        mediaTabId = null;
      }
    }

    // Fallback: broadcast to ALL tabs and let them decide
    const tabs = await chrome.tabs.query({});
    console.log("[inSync] Broadcasting command to", tabs.length, "tabs");
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[inSync] Error forwarding to content script:", err);
  }
}

// ── Broadcast connection state to popup ──────────────────────────────

function broadcastState(extra = {}) {
  const state = {
    type: "STATE_UPDATE",
    connected: ws?.readyState === WebSocket.OPEN,
    roomCode,
    ...extra,
  };

  // Store for popup to read on open
  chrome.storage.session.set({
    connected: state.connected,
    roomCode: state.roomCode,
  });

  // Notify any open popup
  chrome.runtime.sendMessage(state).catch(() => {});
}

// ── Listen for messages from content scripts & popup ─────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "CREATE_ROOM":
      connect(message.serverUrl || DEFAULT_SERVER_URL);
      // Ensure the content script is injected in the active tab
      injectIntoActiveTab();
      // Wait for WS to open, then send create
      waitForOpen(() => {
        sendToServer({ type: "CREATE_ROOM" });
      });
      sendResponse({ ok: true });
      break;

    case "JOIN_ROOM":
      connect(message.serverUrl || DEFAULT_SERVER_URL);
      // Ensure the content script is injected in the active tab
      injectIntoActiveTab();
      waitForOpen(() => {
        sendToServer({ type: "JOIN_ROOM", code: message.code });
      });
      sendResponse({ ok: true });
      break;

    case "LEAVE_ROOM":
      sendToServer({ type: "LEAVE_ROOM" });
      disconnect();
      sendResponse({ ok: true });
      break;

    case "MEDIA_EVENT":
      // From content script — forward to server
      console.log("[inSync] Local media event:", message.event, "time:", message.time);
      // Track which tab sent the media event
      if (sender?.tab?.id) {
        mediaTabId = sender.tab.id;
      }
      sendToServer({
        type: "MEDIA_EVENT",
        event: message.event,
        time: message.time,
      });
      sendResponse({ ok: true });
      break;

    case "REGISTER_MEDIA":
      // Content script found a media element — remember this tab
      if (sender?.tab?.id) {
        mediaTabId = sender.tab.id;
        console.log("[inSync] Media registered on tab:", mediaTabId);
      }
      sendResponse({ ok: true });
      break;

    case "GET_STATE":
      sendResponse({
        connected: ws?.readyState === WebSocket.OPEN,
        roomCode,
      });
      break;
  }

  // Return true to keep the message channel open for async sendResponse
  return true;
});

// ── Utility ──────────────────────────────────────────────────────────

function waitForOpen(callback, timeout = 5000) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    callback();
    return;
  }

  const start = Date.now();
  const check = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      clearInterval(check);
      callback();
    } else if (Date.now() - start > timeout) {
      clearInterval(check);
      console.error("[inSync] Connection timed out");
      broadcastState({ error: "Connection timed out" });
    }
  }, 100);
}

// ── URL sync ─────────────────────────────────────────────────────────

/**
 * Navigate the media tab (or active tab) to the given URL.
 * Sends REMOTE_URL to the content script so it can show a toast, then navigates.
 */
async function navigateToUrl(url) {
  urlSyncLock = true;

  try {
    // First, try to show a toast on the current tab
    const targetTabId = mediaTabId;
    if (targetTabId) {
      try {
        await chrome.tabs.sendMessage(targetTabId, {
          type: "REMOTE_URL",
          url,
        });
      } catch {
        // Content script may not be running; navigate directly
        await chrome.tabs.update(targetTabId, { url });
      }
    } else {
      // No known media tab — navigate the active tab
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tabs[0]?.id) {
        await chrome.tabs.update(tabs[0].id, { url });
      }
    }
  } catch (err) {
    console.error("[inSync] Error navigating to URL:", err);
  }

  // Release lock after navigation settles
  setTimeout(() => {
    urlSyncLock = false;
  }, 3000);
}

/**
 * Listen for tab URL changes — when the user navigates,
 * broadcast the new URL to peers.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only care about URL changes on the media tab (or active tab)
  if (!changeInfo.url) return;
  if (!roomCode) return;
  if (urlSyncLock) return;

  // Only sync if this is the media tab or an active tab
  const isMediaTab = mediaTabId && tabId === mediaTabId;
  const isActiveTab = tab.active;

  if (!isMediaTab && !isActiveTab) return;

  // Only sync http/https URLs
  if (!changeInfo.url.startsWith("http")) return;

  console.log("[inSync] Local URL change:", changeInfo.url);
  sendToServer({
    type: "URL_CHANGE",
    url: changeInfo.url,
  });

  // Update media tab tracking to the new tab
  mediaTabId = tabId;

  // Re-inject content script into the new page after it loads
  setTimeout(() => ensureContentScript(tabId), 2000);
});
