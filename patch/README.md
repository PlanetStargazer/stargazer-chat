# 🌌 Stargazer Chat

> A modern, self-hosted real-time communication platform featuring text channels, direct messaging, multi-party WebRTC mesh voice and video calling, screen sharing, automatic URL image previews on hover, and drag-and-drop file sharing.
>
> **Developed by [Antigravity](https://deepmind.google/)** (Google DeepMind's Advanced Agentic Coding Assistant) in pair programming collaboration with **PlanetStargazer** (`ezekiel.stargazer@gmail.com`).

---

## 🌟 Highlights & Features

### 💬 Real-Time Text Messaging & Channels
- **Channels & Direct Messages**: Create, switch, and manage public channels (e.g. `#general`) or start private, encrypted 1-on-1 direct conversations.
- **Edit Last Message**: Press the **Up Arrow (`↑`)** when the message input is focused (or click the edit pencil icon) to edit previously sent messages with automatic `(edited)` badges.
- **Emoticon to Emoji Parser**: Automatically translates classic emoticons (`:)`, `;)`, `<3`, `:D`, `XD`, `:P`, etc.) into modern Unicode emojis without breaking URLs or code blocks.
- **User Mentions (`@username`)**: Type `@` to trigger an autocomplete suggestion popup. Mentioned users receive desktop alerts and a distinctive glowing red LED indicator next to the channel/contact that stays illuminated until the conversation is read.
- **Custom Online Presence**:
  - **Online** 🟢
  - **Away** 🟡 (automatically triggered after 15 minutes of inactivity, resuming Online upon user interaction)
  - **Do Not Disturb (DND)** 🔴 (suppresses all notifications, ringtones, and incoming call sounds)

### 📞 WebRTC Voice & Video Calling (P2P Mesh)
- **1-on-1 Direct Calls with Ringing**:
  - Synthesized Web Audio ringing tones for both caller and receiver until answered or declined.
  - Incoming call popup with a 30-second countdown timer that automatically ends the call if unanswered.
- **Channel Voice & Video Group Calls**:
  - Instant channel calls: any user in a channel is automatically connected via WebRTC voice/video.
  - To respect privacy, users join channel calls with camera disabled and microphone muted; only the person who started the call has their mic and camera enabled.
- **Robust W3C Perfect Negotiation**:
  - Full WebRTC mesh negotiation with `rollback` handling to prevent glare and offer collisions in multi-party conferences.
  - Dedicated DOM-attached audio sinks per remote peer to eliminate browser audio throttling and double playback echo.
  - Automatic ICE restarts on connection state changes.
- **Screen Sharing & Spotlight**:
  - Share screens, windows, or browser tabs with 60 FPS support.
  - Spotlight/pin any peer tile to enlarge their stream.
  - Individual volume sliders for each remote participant.

### 🔗 URL Image Previews on Hover
- **Automatic Linkification**: Plain-text URLs (`https://...`) are converted into interactive links.
- **Floating Hover Image Card**: Hovering over any link displays a floating card showing an image preview, website domain, page title, and meta description.
- **Direct Images & Web Scraper**: Direct image links render instantly; general websites are parsed via a secure server-side OpenGraph (`og:image`, `og:title`) scraper with SSRF protection and high-resolution thumbnail fallbacks.
- **Dual-Tier Caching**: Previews are cached in-memory and in SQLite for instant rendering on repeat hovers.

### 📁 Drag-and-Drop File Sharing (Up to 128 MB)
- **Drag & Drop Overlay**: Simply drag any files onto the chat window to trigger a styled drop zone.
- **Universal Format Support**: Share PDFs, TXT, Word/DOCX, Excel/XLSX, ZIP/RAR/7z archives, audio files, videos, and images up to 128 MB.
- **Interactive File Cards**:
  - Distinctive color-coded badges per file format.
  - One-click file download buttons.
  - Built-in text file reader modal (`👁️ View`) to inspect `.txt`, `.log`, `.md`, `.json`, `.csv`, and code files without downloading.
  - Inline audio player for `.mp3`, `.wav`, and `.ogg` files.
  - Full-resolution image lightbox for pictures.

### 🛡️ Admin Control Center
- **Role Management**: Promote standard members to Administrator or demote administrators, with safety guards ensuring the last remaining admin cannot be demoted.
- **Saved Chats Storage Tab**: Lists all channel and direct message histories, message counts, and storage footprints in KB/MB (without exposing private message contents), with single-click deletion upon confirmation.
- **Uploads Storage Tab & 2-Week Pruning**: Inspects all shared files, sizes, upload dates, and thumbnail previews, with manual deletion and an automated bulk pruning button for files older than 14 days.
- **Confirmation Safeguards**: Every administrative deletion (members, chats, uploads, role changes) requires explicit confirmation in a styled modal.

---

## 🏗️ Architecture & Technology Stack

| Layer | Technologies | Details |
| :--- | :--- | :--- |
| **Frontend** | Vanilla JavaScript (ES6+), HTML5, CSS3 | Glassmorphism UI, zero frontend build tools, zero npm packages, fast native performance |
| **Media & P2P** | WebRTC (Mesh topology), Web Audio API | Perfect Negotiation (`RTCPeerConnection`), STUN NAT traversal, DataChannels for control signaling |
| **Backend** | PHP 8.x, SQLite 3 (PDO) | Single-file RESTful JSON API (`api.php`), session tokens, WebRTC signaling queue, OpenGraph link scraper |
| **Storage** | Local SQLite (`database/chat.sqlite`), File Storage (`uploads/`) | Automatic schema migrations, 7-day image retention, 14-day upload pruner |

---

## 🚀 Getting Started

### Prerequisites
- PHP 8.0 or higher with PDO SQLite and cURL extensions enabled.
- A modern web browser (Google Chrome, Mozilla Firefox, Microsoft Edge, or Safari).

### Quick Local Start
1. Clone the repository:
   ```bash
   git clone https://github.com/PlanetStargazer/stargazer-chat.git
   cd stargazer-chat
   ```
2. Start the built-in PHP development server:
   ```bash
   php -S 0.0.0.0:8080
   ```
   *(On Windows, you can simply double-click `start-server.bat`)*
3. Open your browser and navigate to:
   ```
   http://localhost:8080
   ```
4. Register a new account. The first registered account automatically receives Administrator privileges!

---

## 📦 Deployment & Server Updates

The repository includes a dedicated **`patch/`** folder containing clean, production-ready files that can be uploaded directly to update your server:

```
stargazer-chat/
├── api.php                 # Backend API, WebRTC signaling & database router
├── index.html              # Main chat interface and dialog modals
├── assets/
│   ├── css/style.css       # Complete dark-mode glassmorphic styles
│   └── js/app.js           # Client logic, WebRTC mesh engine, UI state
├── database/               # SQLite database directory (.htaccess protected)
├── uploads/                # Shared files and images storage
├── patch/                  # Pre-packaged release files ready for FTP/SSH deployment
├── start-server.bat        # Windows one-click local server launcher
└── README.md
```

### Recommended `php.ini` Settings (for 128 MB Uploads)
```ini
upload_max_filesize = 128M
post_max_size = 135M
memory_limit = 256M
```

---

## 👤 Credits

- **Author & Project Owner**: [PlanetStargazer](https://github.com/PlanetStargazer) (`ezekiel.stargazer@gmail.com`)
- **Architected & Coded by**: [Antigravity](https://deepmind.google/) (Google DeepMind Advanced Agentic Coding)
