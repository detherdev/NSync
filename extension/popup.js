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

// ── UI state management ──────────────────────────────────────────────

function showConnected(code, peerCount) {
  viewDisconnected.classList.add("hidden");
  viewConnected.classList.remove("hidden");
  statusDot.classList.add("connected");
  statusLabel.textContent = "Connected";
  roomCodeEl.textContent = code || "------";
  peerCountEl.textContent = peerCount || 1;
  errorText.textContent = "";
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

async function init() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (response?.connected && response?.roomCode) {
      const data = await chrome.storage.session.get(["peerCount"]);
      showConnected(response.roomCode, data.peerCount);
    } else {
      showDisconnected();
    }
  } catch {
    showDisconnected();
  }
}

// ── Event listeners ──────────────────────────────────────────────────

btnCreate.addEventListener("click", () => {
  btnCreate.disabled = true;
  chrome.runtime.sendMessage({ type: "CREATE_ROOM" });
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
  chrome.runtime.sendMessage({ type: "JOIN_ROOM", code });
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
  if (code && code !== "------") {
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
      showConnected(message.roomCode, message.peerCount);
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
