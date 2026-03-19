# Privacy Policy for Play inSync

Last updated: March 19, 2026

Play inSync ("we," "our," or "the extension") is committed to protecting your privacy. This Privacy Policy explains our data practices regarding the collection, use, and disclosure of your information when you use our browser extension.

## 1. Data Collection

**We do not collect, store, or transmit any personally identifiable information (PII) or usage analytics.**

Play inSync is designed to operate with maximum privacy:
*   We do not use tracking cookies.
*   We do not integrate with third-party analytics services (such as Google Analytics).
*   We do not log your browsing history or the media you watch.

## 2. How the Extension Works

The extension requires specific permissions to function. Here is exactly how they are used:

*   **`activeTab` & `tabs`**: Used locally in your browser to detect the active media element (video or audio) on the current page and to synchronize URL navigation when you change pages within a watch party.
*   **`scripting`**: Used strictly to inject the synchronization script into the active tab when you join or create a room.
*   **`storage`**: Used to temporarily save your current room code and connection state (e.g., connected/disconnected) so the extension popup can display the correct information when opened. This data is stored locally using `chrome.storage.session` and is cleared when your browser session ends.
*   **Host Permissions (`<all_urls>`)**: The extension needs permission to run on any webpage to detect media elements (like YouTube, Plex, Vimeo, etc.). It only interacts with HTML `<video>` and `<audio>` tags.

## 3. Data Transmission (Signaling Server)

To synchronize playback between you and your peers, the extension connects to a lightweight WebSocket signaling server.

*   **What is transmitted**: Only necessary synchronization events (Play, Pause, Seek commands along with the current video timestamp) and URL changes are sent through the server.
*   **No logging**: The server routes these momentary messages between connected peers in a room. It does not log, store, or persist any of this data. Once a message is broadcasted to the room, it is immediately discarded by the server.
*   **No Accounts**: You do not need an account to use the application. Room codes are randomly generated and temporary.

## 4. Third-Party Services

We do not sell, trade, or otherwise transfer your information to outside parties. The extension relies on a Render-hosted WebSocket server, which acts solely as a message relay between peers in a watch party.

## 5. Changes to this Privacy Policy

We may update this Privacy Policy from time to time as the extension evolves or as required by platform policies. Any changes will be reflected in this document with an updated date.

## 6. Contact

If you have any questions or concerns about this Privacy Policy or how your data is handled, please reach out via our [GitHub Repository](https://github.com/detherdev/NSync/issues).
