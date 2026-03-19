# NSync

A Chromium browser extension that syncs media playback across browsers. Create a room, share the code, and watch together in real time.

## Features

- **Play/Pause Sync** — press play or pause and all peers follow
- **Seek Sync** — jump to any timestamp and everyone catches up
- **Room Codes** — 6-character codes for easy sharing
- **Works Everywhere** — YouTube, Plex, and any site with `<video>` or `<audio>` elements

## Quick Start

### 1. Start the signaling server

```bash
cd server
npm install
npm start          # runs on ws://localhost:3000
```

### 2. Load the extension

1. Open `chrome://extensions` in Chrome (or any Chromium browser)
2. Enable **Developer Mode** (toggle in the top-right)
3. Click **Load unpacked** → select the `extension/` folder
4. The NSync icon will appear in your toolbar

### 3. Create or join a room

- Click the extension icon → **Create Room** to get a code
- Share the code with a friend
- They click the icon → paste the code → **Join**
- Open any media on both browsers — playback stays in sync!

## Architecture

```
extension/          Chrome extension (Manifest V3)
├── manifest.json   Extension config
├── content.js      Detects & controls media elements
├── background.js   Service worker — WebSocket relay
├── popup.*         Room management UI
└── icons/          Extension icons

server/             Node.js signaling server
├── index.js        WebSocket room & broadcast logic
└── index.test.js   Unit tests
```

## Running Tests

```bash
cd server
npm test
```

## Tech Stack

| Component | Technology |
|---|---|
| Extension | Chrome Manifest V3, vanilla JS |
| Server | Node.js, `ws` |
| Protocol | JSON over WebSocket |
