/**
 * NSync — Server Tests
 *
 * Run with: node --test index.test.js
 */

"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { WebSocket } = require("ws");
const { createServer } = require("./index.js");

const TEST_PORT = 9876;

/**
 * Helper: create a WebSocket client connected to the test server
 */
function createClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

/**
 * Helper: wait for the next JSON message from a WebSocket
 */
function nextMessage(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for message")), timeoutMs);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()));
    });
  });
}

describe("NSync Server", () => {
  let wss;

  before(() => {
    wss = createServer({ port: TEST_PORT, wssOptions: {} });
  });

  after(() => {
    wss.close();
  });

  // ── CREATE_ROOM ──────────────────────────────────────────────────

  it("should create a room and return a 6-char code", async () => {
    const ws = await createClient();

    ws.send(JSON.stringify({ type: "CREATE_ROOM" }));
    const msg = await nextMessage(ws);

    assert.equal(msg.type, "ROOM_CREATED");
    assert.equal(typeof msg.code, "string");
    assert.equal(msg.code.length, 6);

    ws.close();
  });

  // ── JOIN_ROOM ────────────────────────────────────────────────────

  it("should join an existing room", async () => {
    const host = await createClient();
    const guest = await createClient();

    // Host creates room
    host.send(JSON.stringify({ type: "CREATE_ROOM" }));
    const created = await nextMessage(host);

    // Guest joins
    guest.send(JSON.stringify({ type: "JOIN_ROOM", code: created.code }));
    const joined = await nextMessage(guest);

    assert.equal(joined.type, "ROOM_JOINED");
    assert.equal(joined.code, created.code);
    assert.equal(joined.peerCount, 2);

    // Host should receive PEER_JOINED
    const peerJoined = await nextMessage(host);
    assert.equal(peerJoined.type, "PEER_JOINED");
    assert.equal(peerJoined.peerCount, 2);

    host.close();
    guest.close();
  });

  it("should return error for invalid room code", async () => {
    const ws = await createClient();

    ws.send(JSON.stringify({ type: "JOIN_ROOM", code: "ZZZZZZ" }));
    const msg = await nextMessage(ws);

    assert.equal(msg.type, "ERROR");
    assert.match(msg.message, /not found/i);

    ws.close();
  });

  // ── MEDIA_EVENT broadcast ────────────────────────────────────────

  it("should broadcast MEDIA_EVENT to peers but not the sender", async () => {
    const host = await createClient();
    const guest = await createClient();

    // Host creates room
    host.send(JSON.stringify({ type: "CREATE_ROOM" }));
    const created = await nextMessage(host);

    // Guest joins
    guest.send(JSON.stringify({ type: "JOIN_ROOM", code: created.code }));
    await nextMessage(guest); // ROOM_JOINED
    await nextMessage(host); // PEER_JOINED

    // Host sends a play event
    host.send(
      JSON.stringify({ type: "MEDIA_EVENT", event: "play", time: 42.5 })
    );

    // Guest should receive it
    const event = await nextMessage(guest);
    assert.equal(event.type, "MEDIA_EVENT");
    assert.equal(event.event, "play");
    assert.equal(event.time, 42.5);

    host.close();
    guest.close();
  });

  it("should error on MEDIA_EVENT when not in a room", async () => {
    const ws = await createClient();

    ws.send(JSON.stringify({ type: "MEDIA_EVENT", event: "play", time: 0 }));
    const msg = await nextMessage(ws);

    assert.equal(msg.type, "ERROR");
    assert.match(msg.message, /not in a room/i);

    ws.close();
  });

  // ── Disconnect cleanup ───────────────────────────────────────────

  it("should clean up room on disconnect and notify peers", async () => {
    const host = await createClient();
    const guest = await createClient();

    // Host creates room
    host.send(JSON.stringify({ type: "CREATE_ROOM" }));
    const created = await nextMessage(host);

    // Guest joins
    guest.send(JSON.stringify({ type: "JOIN_ROOM", code: created.code }));
    await nextMessage(guest); // ROOM_JOINED
    await nextMessage(host); // PEER_JOINED

    // Guest disconnects
    guest.close();

    // Host should receive PEER_LEFT
    const peerLeft = await nextMessage(host);
    assert.equal(peerLeft.type, "PEER_LEFT");
    assert.equal(peerLeft.peerCount, 1);

    host.close();
  });

  // ── LEAVE_ROOM ───────────────────────────────────────────────────

  it("should handle LEAVE_ROOM gracefully", async () => {
    const ws = await createClient();

    ws.send(JSON.stringify({ type: "CREATE_ROOM" }));
    await nextMessage(ws); // ROOM_CREATED

    ws.send(JSON.stringify({ type: "LEAVE_ROOM" }));
    const msg = await nextMessage(ws);

    assert.equal(msg.type, "LEFT_ROOM");

    ws.close();
  });

  // ── PING/PONG ────────────────────────────────────────────────────

  it("should respond to PING with PONG", async () => {
    const ws = await createClient();

    ws.send(JSON.stringify({ type: "PING" }));
    const msg = await nextMessage(ws);

    assert.equal(msg.type, "PONG");

    ws.close();
  });
});
