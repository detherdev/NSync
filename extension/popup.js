/**
 * Play inSync — Popup Script
 *
 * Handles UI interactions for creating/joining rooms
 * and displays connection state.
 */

"use strict";

// ── DOM elements ─────────────────────────────────────────────────────
const viewDisconnected = document.getElementById("viewDisconnected");
const viewConnected = document.getElementById("viewConnected");
const statusDot = document.getElementById("statusDot");
const statusLabel = document.getElementById("statusLabel");
const btnCreate = document.getElementById("btnCreate");
const btnJoin = document.getElementById("btnJoin");
const btnLeave = document.getElementById("btnLeave");
const btnCopy = document.getElementById("btnCopy");
const inputCode = document.getElementById("inputCode");
const roomCodeEl = document.getElementById("roomCode");
const peerCountEl = document.getElementById("peerCount");
const errorText = document.getElementById("errorText");
const selectTab = document.getElementById("selectTab");
const btnTheme = document.getElementById("btnTheme");
const iconSun = document.getElementById("iconSun");
const iconMoon = document.getElementById("iconMoon");

// ── Theme management ─────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (theme === "light") {
    iconSun.style.display = "none";
    iconMoon.style.display = "block";
  } else {
    iconSun.style.display = "block";
    iconMoon.style.display = "none";
  }
}

// Load saved theme
chrome.storage.local.get(["theme"], (result) => {
  applyTheme(result.theme || "dark");
});

btnTheme.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  chrome.storage.local.set({ theme: next });
});

// ── UI state management ──────────────────────────────────────────────

async function showConnected(code, peerCount, mediaTabId) {
  viewDisconnected.classList.add("hidden");
  viewConnected.classList.remove("hidden");
  statusDot.classList.add("connected");
  statusLabel.textContent = "Connected";
  roomCodeEl.textContent = code || "----";
  peerCountEl.textContent = peerCount || 1;
  errorText.textContent = "";

  await loadTabs(selectTab, mediaTabId);
}

function showDisconnected() {
  viewConnected.classList.add("hidden");
  viewDisconnected.classList.remove("hidden");
  statusDot.classList.remove("connected");
  statusLabel.textContent = "Disconnected";
  inputCode.value = "";
  errorText.textContent = "";
}

function showError(message) {
  errorText.textContent = message;
  setTimeout(() => {
    errorText.textContent = "";
  }, 4000);
}

// ── Initialize popup with current state ──────────────────────────────

async function loadTabs(selectElement, initiallySelectedId) {
  try {
    const tabs = await chrome.tabs.query({ windowType: "normal" });
    const eligibleTabs = tabs.filter(t => t.url && (t.url.startsWith("http://") || t.url.startsWith("https://")));
    
    let defaultTabId = initiallySelectedId;
    if (!defaultTabId) {
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      defaultTabId = activeTabs[0]?.id;
    }

    selectElement.innerHTML = "";
    
    if (eligibleTabs.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No media tabs found";
      selectElement.appendChild(option);
      return;
    }

    eligibleTabs.forEach(tab => {
      const option = document.createElement("option");
      option.value = tab.id;
      const title = tab.title || tab.url;
      option.textContent = title.length > 45 ? title.substring(0, 45) + "..." : title;
      if (tab.id === defaultTabId) {
        option.selected = true;
      }
      selectElement.appendChild(option);
    });
  } catch (err) {
    console.error("Failed to load tabs", err);
    selectElement.innerHTML = '<option value="">Error loading tabs</option>';
  }
}

async function init() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (response?.connected && response?.roomCode) {
      const data = await chrome.storage.session.get(["peerCount"]);
      showConnected(response.roomCode, data.peerCount, response.mediaTabId);
    } else {
      await loadTabs(selectTab);
      showDisconnected();
    }
  } catch {
    await loadTabs(selectTab);
    showDisconnected();
  }
}

// ── Chrome tab listeners for dynamic updates ─────────────────────────

async function refreshTabs() {
  const currentVal = parseInt(selectTab.value, 10) || null;
  await loadTabs(selectTab, currentVal);
}

chrome.tabs.onCreated.addListener(() => refreshTabs());
chrome.tabs.onRemoved.addListener(() => refreshTabs());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.title || changeInfo.url) {
    refreshTabs();
  }
});

// ── Event listeners ──────────────────────────────────────────────────

selectTab.addEventListener("change", () => {
  const tabId = parseInt(selectTab.value, 10);
  if (tabId && !viewConnected.classList.contains("hidden")) {
    chrome.runtime.sendMessage({ type: "CHANGE_TAB", tabId });
  }
});

btnCreate.addEventListener("click", () => {
  btnCreate.disabled = true;
  const tabId = parseInt(selectTab.value, 10) || null;
  chrome.runtime.sendMessage({ type: "CREATE_ROOM", tabId });
  // State will update via the message listener below
  setTimeout(() => {
    btnCreate.disabled = false;
  }, 2000);
});

btnJoin.addEventListener("click", () => {
  const code = inputCode.value.trim().toUpperCase();
  if (!code || code.length < 4) {
    showError("Please enter a valid room code");
    return;
  }
  btnJoin.disabled = true;
  const tabId = parseInt(selectTab.value, 10) || null;
  chrome.runtime.sendMessage({ type: "JOIN_ROOM", code, tabId });
  setTimeout(() => {
    btnJoin.disabled = false;
  }, 2000);
});

// Allow pressing Enter to join
inputCode.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    btnJoin.click();
  }
});

// Auto-uppercase the room code input
inputCode.addEventListener("input", () => {
  inputCode.value = inputCode.value.toUpperCase();
});

btnLeave.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "LEAVE_ROOM" });
  showDisconnected();
});

btnCopy.addEventListener("click", async () => {
  const code = roomCodeEl.textContent;
  if (code && code !== "----") {
    await navigator.clipboard.writeText(code);
    btnCopy.title = "Copied!";
    setTimeout(() => {
      btnCopy.title = "Copy code";
    }, 1500);
  }
});

// ── Listen for state updates from the service worker ─────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE_UPDATE") {
    if (message.connected && message.roomCode) {
      showConnected(message.roomCode, message.peerCount, message.mediaTabId);
    } else {
      showDisconnected();
    }

    if (message.error) {
      showError(message.error);
    }
  }
});

// ── Listen for storage changes (peer count updates) ──────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.peerCount) {
    peerCountEl.textContent = changes.peerCount.newValue || 1;
  }
});

// ── Start ────────────────────────────────────────────────────────────
init();
