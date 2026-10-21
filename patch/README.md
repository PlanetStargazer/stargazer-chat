# Stargazer Chat — Update Patch

This patch contains the complete update package including:
- **Channel Voice & Video Auto-Join**: Starting voice/video in a channel connects anyone currently in that channel automatically with camera off and microphone muted. Only the initiator who started the call has their camera and mic enabled.
- **Direct 1-on-1 Calls with Acceptance & Ringing**: In direct conversations, audio/video connections are only established after the callee accepts. Both parties hear a synthesized ringing tone until accepted or declined. Prominent incoming and outgoing call dialogs with a 30-second countdown auto-terminate calls if unanswered.
- **Custom Online Status & 15-Minute Auto-Away**: Users can toggle between **Online** 🟢, **Away** 🟡, and **Do Not Disturb (DND)** 🔴. The client automatically switches to Away after 15 minutes of inactivity and returns to Online upon user interaction. When set to DND, all calls, ringtones, and notification sounds are muted.
- **User Mentions (`@username`) & Red LED Indicators**: Mentioning users with `@` highlights their name in chat and suggests names via an autocomplete dropdown. Mentioned users receive an alert and a glowing red LED indicator next to the corresponding channel or contact in the sidebar, which disappears once the conversation is opened and read.
- **Admin Control Center**: Promote & demote administrators with confirmation dialogs.
- **Saved Chats Storage Tab**: Lists all channels and DM rooms, message counts, and storage footprint in KB/MB (without exposing message content), with deletion upon confirmation.
- **Uploads Storage Tab & 2-Week Pruning**: Lists all shared files, sizes, upload dates, and thumbnail previews, with deletion upon confirmation and bulk pruning for files older than 14 days.
- **Emoticon to Emoji Parser**: Automatically translates emoticons (`:)`, `;-)`, `<3`, `XD`, `:D`, `:P`, etc.) into emojis while protecting URLs.
- **Confirmation Safeguards**: Required confirmation dialogs before deleting members, chats, uploads, or modifying admin privileges.
- **Message Editing via Up Arrow (`ArrowUp`)** & **Image Sharing (up to 128 MB)**.

---

## 📦 What's Included in This Patch

```
patch/
├── api.php                 # Backend: admin_toggle_role, admin_list_chats, admin_delete_chat,
│                           #          admin_list_uploads, admin_delete_upload, admin_prune_uploads,
│                           #          edit_message, upload_image, 128MB limit, 7-day retention
├── index.html              # Frontend: 3-tab admin panel (Members, Chats, Uploads), confirmation modal,
│                           #          edit bar, upload bar, oversized file alert, image lightbox
├── assets/
│   ├── css/
│   │   └── style.css       # Styles for admin tabs, chat cards, upload cards, badges, lightbox
│   └── js/
│       └── app.js          # Emoticon parser, admin tab logic, chat/upload management, confirmation dialogs
├── uploads/
│   └── .gitkeep            # Uploads directory structure
└── README.md               # Deployment instructions
```

---

## 🚀 How to Apply the Patch on Your Server

### Step 1: Upload Files
Copy the contents of `patch/` directly into your web root directory (where your current `index.html` and `api.php` reside), replacing existing files:
- `api.php`
- `index.html`
- `assets/css/style.css`
- `assets/js/app.js`
- `uploads/` directory

### Step 2: Ensure Write Permissions on `uploads/`
The web server needs write permissions on the `uploads/` folder to store uploaded images:
```bash
chmod 755 uploads
# or chown to web server user if necessary:
# chown -R www-data:www-data uploads
```

### Step 3: PHP Configuration for 128 MB Uploads (Optional / Recommended)
In your `php.ini` (or `.user.ini` / `.htaccess`), verify or adjust the max upload directives to permit 128 MB files:
```ini
upload_max_filesize = 128M
post_max_size = 135M
memory_limit = 256M
```

### Step 4: Automatic Database Migration
No manual SQL commands are required! When `api.php` runs, it automatically verifies the SQLite schema and initializes any missing columns/tables.

---

## ✨ Features Added in This Release

### 1. Promote & Demote Admins
- Within the **Admin Control Center** > **Members** tab, administrators now see:
  - **`Make Admin`**: Grants administrative privileges to any regular member.
  - **`Demote Admin`**: Demotes an administrator back to a standard member.
- **Safety checks**:
  - The instance's last remaining administrator cannot be demoted.
  - Every promotion and demotion requires explicit confirmation via the styled modal.

### 2. Saved Chats Storage Tab
- Located under **Admin Control Center** > **Saved Chats**.
- Lists every saved chat room (channels like `#general` and direct messages like `@User1 & @User2`).
- Displays:
  - Total number of chats, total messages, and total storage footprint.
  - Per room: channel/DM icon, room title, message count, and approximate storage size in **KB / MB**.
  - As requested, message content itself is private and not displayed.
- **Delete Chat History**: Allows deleting all messages in a room (and non-default channels) with a detailed confirmation modal indicating how many messages and bytes will be freed.

### 3. Uploads Storage Tab & 2-Week Pruning
- Located under **Admin Control Center** > **Uploads Storage**.
- Displays:
  - Total uploads count, total disk space consumed, and count of files older than 2 weeks.
  - Image thumbnail preview (click to open full-screen in lightbox).
  - Filename, file size, uploader username, channel/room, and upload timestamp.
  - Badges highlighting files that are **`> 2 Weeks Old`**.
- **Prune Uploads > 2 Weeks**: Dedicated action button at the top to delete all uploaded images older than 14 days in one click.
- **Confirmation Requirement**: Full confirmation dialogs with file and byte counts are required before single file deletion or bulk 2-week pruning.

### 4. Emoticon to Emoji Auto-Translation
- Automatically converts classic text emoticons into their rich Unicode emoji equivalents:
  - `:)`, `:-)`, `=)` → 😊
  - `;-)`, `;)` → 😉
  - `:D`, `:-D`, `=D` → 😃
  - `;D`, `;d` → 😜
  - `:P`, `:-P`, `:p`, `:-p` → 😛
  - `:(`, `:-(`, `=(` → 🙁
  - `:'(`, `:'-(` → 😢
  - `:O`, `:-O`, `:o`, `:-o` → 😮
  - `XD`, `xd` → 😆
  - `<3` → ❤️
  - `</3` → 💔
  - `-_-` → 😑
  - `:|`, `:-|` → 😐
  - `8)`, `8-)`, `B)`, `B-)` → 😎
  - `>:)`, `>;)` → 😈
  - `>:(`, `>:-(` → 😠
  - `:3` → 😺
- Safe parsing prevents modifying URLs (e.g. `http://...` remains completely intact).
- Applied both when sending messages and when rendering incoming/historic messages.

### 5. Channel Deletion & Ghost Message Protection
- **Automatic Fallback & Redirection**: When a channel is deleted, any peer currently inside that channel is automatically alerted (`"The channel you were in was deleted. Switched to #..."`) and smoothly redirected to a valid surviving channel.
- **Ghost Message Prevention**: The backend now strictly validates channel existence on every message, file upload, or room switch, rejecting posts to deleted channels with `404 CHANNEL_NOT_FOUND`.
- **Orphan Cleanup**: Deleting a channel purges all associated messages, files, and signals. Re-creating a channel with the same name starts completely fresh and will never resurrect ghost messages.
- **Deterministic DM Conversation Alignment**: Direct message room IDs are deterministically sorted (`dm-userA-userB`) so both participants share the exact same room and conversation history regardless of who initiated the chat.
