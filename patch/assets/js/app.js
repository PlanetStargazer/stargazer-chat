/**
 * Stargazer Chat — Discord-Style Video, Voice & Text Chat Client
 */

(() => {
    'use strict';

    const API_URL = 'api.php';
    const SYNC_INTERVAL_MS = 1000;

    // Free public STUN servers for direct NAT traversal (STUN never handles or relays media; it only discovers public IP/port)
    const ICE_SERVERS = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
    ];

    const NOTIFICATION_STORAGE_KEY = 'stargazer_notifications_v1';
    const DEFAULT_NOTIFICATIONS = {
        enabled: true,
        directMessages: true,
        channelMessages: 'all', // 'all' | 'none'
        calls: true,
        sound: true,
        onlyInBackground: true,
    };

    function loadNotificationSettings() {
        try {
            const raw = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
            if (!raw) return { ...DEFAULT_NOTIFICATIONS };
            const parsed = JSON.parse(raw);
            return { ...DEFAULT_NOTIFICATIONS, ...parsed };
        } catch (e) {
            return { ...DEFAULT_NOTIFICATIONS };
        }
    }

    const state = {
        authToken: localStorage.getItem('pulsechat_token') || '',
        user: null,
        notifications: loadNotificationSettings(),

        regAvatarDataUrl: '',

        // Active text room (either a channelId like 'general' or a dmRoomId like 'dm-u_1-u_2')
        activeTextRoomId: 'general',
        activeTextRoomType: 'channel', // 'channel' | 'dm'
        activeTextRoomTitle: 'general',
        activeDmContact: null,

        // Active voice/video call room (empty when not in a call)
        inCall: false,
        callRoomId: '',
        callRoomLabel: '',
        peerId: generatePeerId(),

        micEnabled: true,
        camEnabled: true,
        screenSharing: false,

        localStream: null,
        screenStream: null,
        audioContext: null,
        localAnalyser: null,

        channels: [],
        contacts: [],
        members: [],
        activeInvite: null,

        participants: new Map(),
        peers: new Map(),
        renderedMessageIds: new Set(),
        lastMessageId: 0,
        editingMessageId: null,
        roomMessages: new Map(),

        pinnedPeerId: null,
        settingsOpen: false,
        membersSidebarVisible: true,

        syncTimer: null,
        syncInFlight: false,
        signalQueue: [],
        signalFlushTimer: null,

        outgoingCall: null,
        activeIncomingInvite: null,
        activeIncomingTimer: null,
        activeOutgoingTimer: null,
        lastUserInteraction: Date.now(),
        autoAway: false,
        leftChannelCallId: null,
        ringtoneAudioCtx: null,
        ringtoneInterval: null,
        unreadMentions: (() => {
            try { return JSON.parse(localStorage.getItem('stargazer_unread_mentions') || '{}'); }
            catch (e) { return {}; }
        })(),
        urlPreviewCache: new Map(),
    };

    const dom = {
        toastContainer: document.getElementById('toast-container'),
        inviteModal: document.getElementById('invite-modal'),
        inviteAvatarWrap: document.getElementById('invite-avatar-wrap'),
        inviteTitle: document.getElementById('invite-title'),
        inviteSubtitle: document.getElementById('invite-subtitle'),
        inviteTimer: document.getElementById('invite-timer'),
        inviteAcceptVideo: document.getElementById('invite-accept-video'),
        inviteAcceptVoice: document.getElementById('invite-accept-voice'),
        inviteDecline: document.getElementById('invite-decline'),

        outgoingCallModal: document.getElementById('outgoing-call-modal'),
        outgoingCallAvatar: document.getElementById('outgoing-call-avatar'),
        outgoingCallTitle: document.getElementById('outgoing-call-title'),
        outgoingCallSubtitle: document.getElementById('outgoing-call-subtitle'),
        outgoingCallTimer: document.getElementById('outgoing-call-timer'),
        cancelOutgoingCallBtn: document.getElementById('cancel-outgoing-call-btn'),

        userStatusTrigger: document.getElementById('user-status-trigger'),
        userStatusMenu: document.getElementById('user-status-menu'),
        currentUserStatus: document.getElementById('current-user-status'),
        mentionSuggestions: document.getElementById('mention-suggestions'),

        // Auth Screen
        authScreen: document.getElementById('auth-screen'),
        authSubtitle: document.getElementById('auth-subtitle'),
        tabBtnLogin: document.getElementById('tab-btn-login'),
        tabBtnRegister: document.getElementById('tab-btn-register'),
        loginForm: document.getElementById('login-form'),
        loginIdentifier: document.getElementById('login-identifier'),
        loginPassword: document.getElementById('login-password'),
        loginSubmitBtn: document.getElementById('login-submit-btn'),

        registerForm: document.getElementById('register-form'),
        regAvatarPreview: document.getElementById('reg-avatar-preview'),
        regAvatarInput: document.getElementById('reg-avatar-input'),
        regAvatarClear: document.getElementById('reg-avatar-clear'),
        regUsername: document.getElementById('reg-username'),
        regEmail: document.getElementById('reg-email'),
        regPassword: document.getElementById('reg-password'),
        registerSubmitBtn: document.getElementById('register-submit-btn'),

        // Main Workspace
        workspaceScreen: document.getElementById('workspace-screen'),
        mainSidebar: document.getElementById('main-sidebar'),
        mobileSidebarToggle: document.getElementById('mobile-sidebar-toggle'),
        mobileSidebarClose: document.getElementById('mobile-sidebar-close'),
        mobileSidebarBackdrop: document.getElementById('mobile-sidebar-backdrop'),
        mobileMembersClose: document.getElementById('mobile-members-close'),
        mobileMembersBackdrop: document.getElementById('mobile-members-backdrop'),

        contactsOnlineCounter: document.getElementById('contacts-online-counter'),
        toggleAddContactBtn: document.getElementById('toggle-add-contact-btn'),
        addContactForm: document.getElementById('add-contact-form'),
        addContactInput: document.getElementById('add-contact-input'),
        contactsList: document.getElementById('contacts-list'),

        toggleNewChannelBtn: document.getElementById('toggle-new-channel-btn'),
        createChannelForm: document.getElementById('create-channel-form'),
        newChannelInput: document.getElementById('new-channel-input'),
        channelsList: document.getElementById('channels-list'),

        sidebarCallBar: document.getElementById('sidebar-call-bar'),
        callBarRoomName: document.getElementById('call-bar-room-name'),
        sidebarLeaveCallBtn: document.getElementById('sidebar-leave-call-btn'),
        callBarCamBtn: document.getElementById('call-bar-cam-btn'),
        callBarScreenBtn: document.getElementById('call-bar-screen-btn'),

        currentUserAvatar: document.getElementById('current-user-avatar'),
        currentUserName: document.getElementById('current-user-name'),
        quickMicBtn: document.getElementById('quick-mic-btn'),
        quickCamBtn: document.getElementById('quick-cam-btn'),
        openSettingsBtn: document.getElementById('open-settings-btn'),

        // Right Main Area
        roomPrefixIcon: document.getElementById('room-prefix-icon'),
        activeRoomTitle: document.getElementById('active-room-title'),
        activeRoomSubtitle: document.getElementById('active-room-subtitle'),
        unpinAllBtn: document.getElementById('unpin-all-btn'),
        headerVoiceBtn: document.getElementById('header-voice-btn'),
        headerVideoBtn: document.getElementById('header-video-btn'),
        headerLeaveBtn: document.getElementById('header-leave-btn'),
        toggleMembersBtn: document.getElementById('toggle-members-btn'),

        callStage: document.getElementById('call-stage'),
        videoGrid: document.getElementById('video-grid'),
        stageMicBtn: document.getElementById('stage-mic-btn'),
        stageCamBtn: document.getElementById('stage-cam-btn'),
        stageScreenBtn: document.getElementById('stage-screen-btn'),
        stageLeaveBtn: document.getElementById('stage-leave-btn'),

        chatMessages: document.getElementById('chat-messages'),
        emojiPickerPopover: document.getElementById('emoji-picker-popover'),
        emojiSearchInput: document.getElementById('emoji-search-input'),
        emojiCategoryTabs: document.getElementById('emoji-category-tabs'),
        emojiGrid: document.getElementById('emoji-grid'),
        emojiToggleBtn: document.getElementById('emoji-toggle-btn'),
        chatForm: document.getElementById('chat-form'),
        chatInput: document.getElementById('chat-input'),

        membersSidebar: document.getElementById('members-sidebar'),
        membersList: document.getElementById('members-list'),

        // Settings Modal
        settingsModal: document.getElementById('settings-modal'),
        closeSettingsBtn: document.getElementById('close-settings-btn'),
        doneSettingsBtn: document.getElementById('done-settings-btn'),
        testMediaBtn: document.getElementById('test-media-btn'),
        settingsVideoPreview: document.getElementById('settings-video-preview'),
        settingsAvatarFallback: document.getElementById('settings-avatar-fallback'),
        settingsPreviewAvatar: document.getElementById('settings-preview-avatar'),
        settingsCamStatusLabel: document.getElementById('settings-cam-status-label'),
        settingsMicLevel: document.getElementById('settings-mic-level'),
        settingsAudioSource: document.getElementById('settings-audio-source'),
        settingsVideoSource: document.getElementById('settings-video-source'),

        // Notifications Settings Elements
        notifPermissionBadge: document.getElementById('notif-permission-badge'),
        notifBannerTitle: document.getElementById('notif-banner-title'),
        notifBannerDesc: document.getElementById('notif-banner-desc'),
        notifRequestBtn: document.getElementById('notif-request-btn'),
        notifTestBtn: document.getElementById('notif-test-btn'),
        notifToggleDm: document.getElementById('notif-toggle-dm'),
        notifSelectChannel: document.getElementById('notif-select-channel'),
        notifToggleCalls: document.getElementById('notif-toggle-calls'),
        notifToggleSound: document.getElementById('notif-toggle-sound'),
        notifToggleBgonly: document.getElementById('notif-toggle-bgonly'),

        settingsCurrentAvatar: document.getElementById('settings-current-avatar'),
        settingsUserLabel: document.getElementById('settings-user-label'),
        settingsEmailLabel: document.getElementById('settings-email-label'),
        settingsAvatarInput: document.getElementById('settings-avatar-input'),
        settingsRemoveAvatarBtn: document.getElementById('settings-remove-avatar-btn'),
        logoutBtn: document.getElementById('logout-btn'),
        logoutAllBtn: document.getElementById('logout-all-btn'),

        // Admin Interface
        openAdminBtn: document.getElementById('open-admin-btn'),
        settingsAdminBlock: document.getElementById('settings-admin-block'),
        settingsOpenAdminBtn: document.getElementById('settings-open-admin-btn'),
        adminModal: document.getElementById('admin-modal'),
        closeAdminBtn: document.getElementById('close-admin-btn'),
        doneAdminBtn: document.getElementById('done-admin-btn'),
        adminSearchInput: document.getElementById('admin-search-input'),
        adminUserList: document.getElementById('admin-user-list'),
        adminEmptyMsg: document.getElementById('admin-empty-msg'),
        adminTotalLabel: document.getElementById('admin-total-label'),
        adminCountAll: document.getElementById('admin-count-all'),
        adminCountActive: document.getElementById('admin-count-active'),
        adminCountBanned: document.getElementById('admin-count-banned'),
        adminCountAdmins: document.getElementById('admin-count-admins'),

        adminRenameModal: document.getElementById('admin-rename-modal'),
        adminRenameForm: document.getElementById('admin-rename-form'),
        adminRenameTargetDisplay: document.getElementById('admin-rename-target-display'),
        adminRenameInput: document.getElementById('admin-rename-input'),
        closeRenameModalBtn: document.getElementById('close-rename-modal-btn'),
        cancelRenameModalBtn: document.getElementById('cancel-rename-modal-btn'),

        adminBanModal: document.getElementById('admin-ban-modal'),
        adminBanForm: document.getElementById('admin-ban-form'),
        adminBanTargetDisplay: document.getElementById('admin-ban-target-display'),
        adminBanReasonInput: document.getElementById('admin-ban-reason-input'),
        closeBanModalBtn: document.getElementById('close-ban-modal-btn'),
        cancelBanModalBtn: document.getElementById('cancel-ban-modal-btn'),

        adminDeleteModal: document.getElementById('admin-delete-modal'),
        adminDeleteForm: document.getElementById('admin-delete-form'),
        adminDeleteTargetDisplay: document.getElementById('admin-delete-target-display'),
        closeDeleteModalBtn: document.getElementById('close-delete-modal-btn'),
        cancelDeleteModalBtn: document.getElementById('cancel-delete-modal-btn'),

        // Chat Editing & Image Upload Elements
        chatEditBar: document.getElementById('chat-edit-bar'),
        chatEditCancelBtn: document.getElementById('chat-edit-cancel-btn'),
        chatUploadBar: document.getElementById('chat-upload-bar'),
        chatUploadLabel: document.getElementById('chat-upload-label'),
        chatAttachBtn: document.getElementById('chat-attach-btn'),
        chatFileInput: document.getElementById('chat-file-input'),
        chatDropOverlay: document.getElementById('chat-drop-overlay'),

        linkPreviewPopover: document.getElementById('link-preview-popover'),
        linkPreviewImg: document.querySelector('#link-preview-popover .link-preview-img'),
        linkPreviewDomain: document.querySelector('#link-preview-popover .link-preview-domain'),
        linkPreviewTitle: document.querySelector('#link-preview-popover .link-preview-title'),
        linkPreviewDesc: document.querySelector('#link-preview-popover .link-preview-desc'),
        linkPreviewMedia: document.querySelector('#link-preview-popover .link-preview-media'),

        filePreviewModal: document.getElementById('file-preview-modal'),
        filePreviewTitle: document.getElementById('file-preview-modal-title'),
        filePreviewContent: document.getElementById('file-preview-modal-content'),
        filePreviewDownload: document.getElementById('file-preview-modal-download'),
        closeFilePreviewBtn: document.getElementById('close-file-preview-btn'),
        doneFilePreviewBtn: document.getElementById('done-file-preview-btn'),

        fileTooLargeModal: document.getElementById('file-too-large-modal'),
        fileTooLargeActual: document.getElementById('file-too-large-actual'),
        closeFileAlertBtn: document.getElementById('close-file-alert-btn'),
        doneFileAlertBtn: document.getElementById('done-file-alert-btn'),

        imageLightboxModal: document.getElementById('image-lightbox-modal'),
        lightboxImg: document.getElementById('lightbox-img'),
        lightboxDownloadLink: document.getElementById('lightbox-download-link'),
        closeLightboxBtn: document.getElementById('close-lightbox-btn'),

        // Admin Navigation Tabs & Panes
        adminTabBtns: document.querySelectorAll('.admin-tab-btn'),
        adminPaneMembers: document.getElementById('admin-pane-members'),
        adminPaneChats: document.getElementById('admin-pane-chats'),
        adminPaneUploads: document.getElementById('admin-pane-uploads'),

        // Admin Chats
        adminChatsSearchInput: document.getElementById('admin-chats-search-input'),
        adminChatsStatCount: document.getElementById('admin-chats-stat-count'),
        adminChatsStatMsgs: document.getElementById('admin-chats-stat-msgs'),
        adminChatsStatSize: document.getElementById('admin-chats-stat-size'),
        adminChatsList: document.getElementById('admin-chats-list'),
        adminChatsEmptyMsg: document.getElementById('admin-chats-empty-msg'),

        // Admin Uploads
        adminUploadsStatCount: document.getElementById('admin-uploads-stat-count'),
        adminUploadsStatSize: document.getElementById('admin-uploads-stat-size'),
        adminUploadsStatStale: document.getElementById('admin-uploads-stat-stale'),
        adminPruneUploadsBtn: document.getElementById('admin-prune-uploads-btn'),
        adminUploadsList: document.getElementById('admin-uploads-list'),
        adminUploadsEmptyMsg: document.getElementById('admin-uploads-empty-msg'),

        // Admin Confirmation Dialog
        adminConfirmModal: document.getElementById('admin-confirm-modal'),
        adminConfirmTitle: document.getElementById('admin-confirm-title'),
        adminConfirmMessage: document.getElementById('admin-confirm-message'),
        adminConfirmSubtext: document.getElementById('admin-confirm-subtext'),
        cancelConfirmModalBtn: document.getElementById('cancel-confirm-modal-btn'),
        proceedConfirmModalBtn: document.getElementById('proceed-confirm-modal-btn'),
        closeConfirmModalBtn: document.getElementById('close-confirm-modal-btn'),
    };

    // ======================= HELPERS =======================
    function generatePeerId() {
        const arr = new Uint8Array(8);
        if (window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(arr);
        } else {
            for (let i = 0; i < 8; i++) arr[i] = Math.floor(Math.random() * 256);
        }
        return 'p_' + Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }

    function showToast(message, type = 'info') {
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.textContent = message;
        dom.toastContainer.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.25s ease';
            setTimeout(() => el.remove(), 260);
        }, 3500);
    }

    function getInitials(name) {
        const clean = (name || 'U').trim();
        const parts = clean.split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return clean.slice(0, 2).toUpperCase();
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function parseEmoticonsToEmoji(str) {
        if (!str || typeof str !== 'string') return '';

        // Protect URLs from being altered
        const urlPattern = /(https?:\/\/[^\s]+)/gi;
        const parts = str.split(urlPattern);

        const rules = [
            // Hearts & Love
            [/(^|\s)(<3)(?=\s|$|[.,!?])/g, '$1❤️'],
            [/(^|\s)(<\/3)(?=\s|$|[.,!?])/g, '$1💔'],

            // Winks
            [/(^|\s)(;-\)|;\))(?=\s|$|[.,!?])/g, '$1😉'],
            [/(^|\s)(;-(?:D|d)|;(?:D|d))(?=\s|$|[.,!?])/g, '$1😜'],
            [/(^|\s)(;-(?:P|p)|;(?:P|p))(?=\s|$|[.,!?])/g, '$1😜'],

            // Smiles & Grins
            [/(^|\s)(:-\)|\:\)|=\))(?=\s|$|[.,!?])/g, '$1😊'],
            [/(^|\s)(:-D|\:D|=D)(?=\s|$|[.,!?])/g, '$1😃'],
            [/(^|\s)(XD|xd)(?=\s|$|[.,!?])/g, '$1😆'],

            // Tongues
            [/(^|\s)(:-[Pp]|:[Pp]|=[Pp])(?=\s|$|[.,!?])/g, '$1😛'],

            // Sad & Crying
            [/(^|\s)(:-\(|\:\(|=\()(?=\s|$|[.,!?])/g, '$1🙁'],
            [/(^|\s)(:'\(|:'-\()(?=\s|$|[.,!?])/g, '$1😢'],
            [/(^|\s)(>:\(|>:-\()(?=\s|$|[.,!?])/g, '$1😠'],

            // Surprised
            [/(^|\s)(:-[Oo]|:[Oo])(?=\s|$|[.,!?])/g, '$1😮'],

            // Cool / Glasses
            [/(^|\s)(8-\)|8\)|B-\)|B\))(?=\s|$|[.,!?])/g, '$1😎'],

            // Neutral / Bored
            [/(^|\s)(:-\||:\|)(?=\s|$|[.,!?])/g, '$1😐'],
            [/(^|\s)(-_-)(?=\s|$|[.,!?])/g, '$1😑'],

            // Devil
            [/(^|\s)(>:-\)|>:\)|>;-\)|>;\))(?=\s|$|[.,!?])/g, '$1😈'],

            // Cat
            [/(^|\s)(:3)(?=\s|$|[.,!?])/g, '$1😺'],
        ];

        for (let i = 0; i < parts.length; i++) {
            if (i % 2 === 0) {
                for (const [re, repl] of rules) {
                    parts[i] = parts[i].replace(re, repl);
                }
            }
        }
        return parts.join('');
    }

    function renderAvatarMarkup(username, avatarColor, avatarUrl, extraClass = '') {
        if (avatarUrl && avatarUrl.startsWith('data:image/')) {
            return `<img src="${escapeHtml(avatarUrl)}" class="avatar-img ${extraClass}" alt="${escapeHtml(username)}">`;
        }
        const bg = avatarColor || '#c85a9e';
        return `<div class="avatar-circle ${extraClass}" style="background:${escapeHtml(bg)}">${escapeHtml(getInitials(username))}</div>`;
    }

    const MAX_IMAGE_UPLOAD_BYTES = 128 * 1024 * 1024; // 128 MB

    function getFileIconMarkup(ext) {
        const e = (ext || '').toLowerCase();
        if (e === 'pdf') return '📄';
        if (['txt', 'log', 'md'].includes(e)) return '📝';
        if (['doc', 'docx', 'rtf', 'odt'].includes(e)) return '📑';
        if (['xls', 'xlsx', 'csv'].includes(e)) return '📊';
        if (['ppt', 'pptx'].includes(e)) return '📈';
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return '📦';
        if (['mp3', 'wav', 'ogg', 'm4a'].includes(e)) return '🎵';
        if (['mp4', 'webm', 'mkv', 'mov'].includes(e)) return '🎬';
        if (['json', 'js', 'py', 'html', 'css', 'ts', 'php', 'c', 'cpp'].includes(e)) return '💻';
        return '📁';
    }

    function formatMessageBody(text, type = 'text') {
        if (type === 'image') {
            const url = escapeHtml(text);
            return `
                <div class="chat-image-wrap" data-img-url="${url}" title="Click to view full image">
                    <img src="${url}" alt="Shared image" class="chat-image-preview" loading="lazy">
                </div>
            `;
        }

        if (type === 'file') {
            let fileData = null;
            try {
                fileData = JSON.parse(text);
            } catch (e) {
                fileData = { url: text, name: text.split('/').pop(), size: 0, ext: text.split('.').pop() };
            }
            const fileUrl = escapeHtml(fileData.url || text);
            const fileName = escapeHtml(fileData.name || 'Attached File');
            const fileExt = escapeHtml((fileData.ext || fileName.split('.').pop() || 'file').toLowerCase());
            const fileSize = fileData.size ? formatBytes(fileData.size) : '';
            const isText = ['txt', 'md', 'log', 'json', 'csv', 'js', 'py', 'html', 'css'].includes(fileExt);
            const isAudio = ['mp3', 'wav', 'ogg', 'm4a'].includes(fileExt);

            return `
                <div class="chat-file-card" data-file-url="${fileUrl}" data-file-name="${fileName}">
                    <div class="file-icon-badge file-badge-${fileExt}">
                        ${getFileIconMarkup(fileExt)}
                    </div>
                    <div class="file-details">
                        <div class="file-title" title="${fileName}">${fileName}</div>
                        <div class="file-meta">
                            <span class="file-size">${fileSize}</span>
                            <span class="file-ext-tag">${fileExt.toUpperCase()}</span>
                        </div>
                    </div>
                    <div class="file-actions">
                        ${isText ? `
                            <button type="button" class="btn-file-preview" title="Quick View" data-preview-file="${fileUrl}" data-preview-name="${fileName}">
                                👁️ View
                            </button>
                        ` : ''}
                        <a href="${fileUrl}" download="${fileName}" class="btn-file-download" title="Download ${fileName}">
                            ⬇️ Download
                        </a>
                    </div>
                </div>
                ${isAudio ? `
                    <div class="chat-audio-player-wrap">
                        <audio controls preload="metadata" src="${fileUrl}" class="chat-inline-audio"></audio>
                    </div>
                ` : ''}
            `;
        }

        const withEmojis = parseEmoticonsToEmoji(text);
        const escaped = escapeHtml(withEmojis);
        let formatted = escaped.replace(/(https?:\/\/[^\s<]+)/g, (match) => {
            let clean = match;
            let trailing = '';
            while (/[.,!?:;)]$/.test(clean)) {
                trailing = clean.slice(-1) + trailing;
                clean = clean.slice(0, -1);
            }
            return `<a href="${clean}" class="chat-preview-link" data-preview-url="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${trailing}`;
        });

        // Highlight mentions: @username
        formatted = formatted.replace(/@([a-zA-Z0-9_-]+)/g, (match, username) => {
            const isMe = state.user && username.toLowerCase() === state.user.username.toLowerCase();
            return `<span class="mention-tag ${isMe ? 'mention-me' : ''}">@${username}</span>`;
        });

        return formatted;
    }

    function formatTime(unixSeconds) {
        const d = new Date((unixSeconds || Math.floor(Date.now() / 1000)) * 1000);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function formatTimestamp(unixSeconds) {
        if (!unixSeconds) return 'Never';
        const d = new Date(Number(unixSeconds) * 1000);
        if (isNaN(d.getTime())) return 'Unknown';
        return d.toLocaleDateString([], {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        }) + ' ' + d.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function playNotificationChime() {
        if (state.user && state.user.status === 'dnd') return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            const ctx = state.audioContext || new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, ctx.currentTime);
            osc.frequency.setValueAtTime(880, ctx.currentTime + 0.14);
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.42);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.42);
        } catch (e) {}
    }

    // ======================= RINGTONE AUDIO SYNTHESIZER =======================
    function playOutgoingRing() {
        stopRingtone();
        if (state.user && state.user.status === 'dnd') return;

        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioCtx();
            state.ringtoneAudioCtx = ctx;

            function playTonePulse() {
                if (!state.ringtoneAudioCtx) return;
                try {
                    const osc1 = ctx.createOscillator();
                    const osc2 = ctx.createOscillator();
                    const gain = ctx.createGain();

                    osc1.frequency.value = 440;
                    osc2.frequency.value = 480;

                    gain.gain.setValueAtTime(0.04, ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);

                    osc1.connect(gain);
                    osc2.connect(gain);
                    gain.connect(ctx.destination);

                    osc1.start(ctx.currentTime);
                    osc2.start(ctx.currentTime);
                    osc1.stop(ctx.currentTime + 1.8);
                    osc2.stop(ctx.currentTime + 1.8);
                } catch (e) {}
            }

            playTonePulse();
            state.ringtoneInterval = setInterval(playTonePulse, 4000);
        } catch (e) {}
    }

    function playIncomingRing() {
        stopRingtone();
        if (state.user && state.user.status === 'dnd') return;

        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioCtx();
            state.ringtoneAudioCtx = ctx;

            function playChimeCadence() {
                if (!state.ringtoneAudioCtx) return;
                try {
                    const now = ctx.currentTime;
                    const osc1 = ctx.createOscillator();
                    const gain1 = ctx.createGain();
                    osc1.frequency.setValueAtTime(853, now);
                    gain1.gain.setValueAtTime(0.06, now);
                    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
                    osc1.connect(gain1);
                    gain1.connect(ctx.destination);
                    osc1.start(now);
                    osc1.stop(now + 0.6);

                    const osc2 = ctx.createOscillator();
                    const gain2 = ctx.createGain();
                    osc2.frequency.setValueAtTime(960, now + 0.2);
                    gain2.gain.setValueAtTime(0.06, now + 0.2);
                    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
                    osc2.connect(gain2);
                    gain2.connect(ctx.destination);
                    osc2.start(now + 0.2);
                    osc2.stop(now + 0.9);
                } catch (e) {}
            }

            playChimeCadence();
            state.ringtoneInterval = setInterval(playChimeCadence, 2800);
        } catch (e) {}
    }

    function stopRingtone() {
        if (state.ringtoneInterval) {
            clearInterval(state.ringtoneInterval);
            state.ringtoneInterval = null;
        }
        if (state.ringtoneAudioCtx) {
            try {
                state.ringtoneAudioCtx.close();
            } catch (e) {}
            state.ringtoneAudioCtx = null;
        }
    }

    // ======================= SYSTEM NOTIFICATIONS =======================
    function saveNotificationSettings() {
        try {
            localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(state.notifications));
        } catch (e) {}
    }

    function getNotificationPermission() {
        if (!('Notification' in window)) return 'unsupported';
        return Notification.permission;
    }

    function updateNotificationSettingsUI() {
        const perm = getNotificationPermission();
        const badge = dom.notifPermissionBadge;
        if (!badge) return;

        badge.className = `notif-badge ${perm}`;
        if (perm === 'granted') {
            badge.textContent = '● System Active';
            dom.notifRequestBtn.textContent = 'Permission Granted';
            dom.notifRequestBtn.disabled = true;
            dom.notifBannerDesc.textContent = 'Desktop notifications are active. You will receive OS alerts for messages and incoming calls.';
        } else if (perm === 'denied') {
            badge.textContent = '✕ Blocked in Browser';
            dom.notifRequestBtn.textContent = 'Blocked by Browser';
            dom.notifRequestBtn.disabled = true;
            dom.notifBannerDesc.textContent = 'Notifications were blocked in your browser settings. To enable, click the permissions/lock icon in your browser address bar.';
        } else if (perm === 'unsupported') {
            badge.textContent = 'Unsupported';
            dom.notifRequestBtn.textContent = 'Not Supported';
            dom.notifRequestBtn.disabled = true;
            dom.notifBannerDesc.textContent = 'The HTML5 Notification API is not supported in this browser environment.';
        } else {
            badge.textContent = '○ Needs Permission';
            dom.notifRequestBtn.textContent = 'Enable OS Notifications';
            dom.notifRequestBtn.disabled = false;
            dom.notifBannerDesc.textContent = 'Click to allow Stargazer Chat to send native OS alerts for calls and messages.';
        }

        dom.notifToggleDm.checked = Boolean(state.notifications.directMessages);
        dom.notifSelectChannel.value = state.notifications.channelMessages || 'all';
        dom.notifToggleCalls.checked = Boolean(state.notifications.calls);
        dom.notifToggleSound.checked = Boolean(state.notifications.sound);
        dom.notifToggleBgonly.checked = Boolean(state.notifications.onlyInBackground);
    }

    async function requestNotificationPermission() {
        if (!('Notification' in window)) {
            showToast('System notifications are not supported in this browser.', 'warning');
            return 'unsupported';
        }
        try {
            const res = await Notification.requestPermission();
            updateNotificationSettingsUI();
            if (res === 'granted') {
                showToast('Desktop & OS notifications enabled!', 'success');
                dispatchSystemNotification({
                    title: 'Stargazer Chat',
                    body: 'System notifications are now active.',
                    tag: 'system-welcome',
                    force: true,
                });
            } else if (res === 'denied') {
                showToast('Notification permission was blocked in your browser.', 'warning');
            }
            return res;
        } catch (err) {
            updateNotificationSettingsUI();
            return getNotificationPermission();
        }
    }

    function dispatchSystemNotification({ title, body, tag, icon = 'assets/sgg_logo.png', onClick, force = false }) {
        if (state.user && state.user.status === 'dnd') {
            return null;
        }

        if (state.notifications.sound) {
            playNotificationChime();
        }

        if (!('Notification' in window)) return null;
        if (Notification.permission !== 'granted') return null;

        // Skip OS popup if user is actively focused on the app and background-only is enabled
        if (!force && state.notifications.onlyInBackground && document.hasFocus && document.hasFocus()) {
            return null;
        }

        try {
            const notif = new Notification(title, {
                body: body || '',
                icon,
                tag: tag || 'stargazer-msg',
                silent: true, // Audio handled by chime above
            });

            notif.onclick = () => {
                try {
                    window.focus();
                } catch (err) {}
                if (typeof onClick === 'function') {
                    onClick();
                }
                notif.close();
            };

            return notif;
        } catch (err) {
            return null;
        }
    }

    function notifyIncomingMessage(msg, roomId, roomType, roomTitle) {
        if (!msg || !state.user || msg.userId === state.user.userId) return;

        const isDm = roomType === 'dm' || (roomId && roomId.startsWith('dm-'));
        if (isDm) {
            if (!state.notifications.directMessages) return;
            dispatchSystemNotification({
                title: `@${msg.username}`,
                body: msg.content,
                tag: `dm-${msg.userId}`,
                onClick: () => {
                    const contact = state.contacts.find(c => c.userId === msg.userId);
                    if (contact) selectDirectMessage(contact);
                }
            });
        } else {
            if (state.notifications.channelMessages !== 'all') return;
            dispatchSystemNotification({
                title: `#${roomTitle || roomId} · ${msg.username}`,
                body: msg.content,
                tag: `channel-${roomId}`,
                onClick: () => {
                    selectChannel(roomId);
                }
            });
        }
    }

    function resizeImageFileToDataUrl(file, maxSize = 160) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type.startsWith('image/')) {
                reject(new Error('Please select a valid image file.'));
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = maxSize;
                    canvas.height = maxSize;
                    const ctx = canvas.getContext('2d');
                    const minSide = Math.min(img.width, img.height);
                    const sx = (img.width - minSide) / 2;
                    const sy = (img.height - minSide) / 2;
                    ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, maxSize, maxSize);
                    resolve(canvas.toDataURL('image/jpeg', 0.82));
                };
                img.onerror = () => reject(new Error('Could not load image.'));
                img.src = reader.result;
            };
            reader.onerror = () => reject(new Error('Could not read file.'));
            reader.readAsDataURL(file);
        });
    }

    async function apiRequest(action, payload = {}) {
        const bodyObj = { action, ...payload };
        if (state.authToken && !bodyObj.auth_token) {
            bodyObj.auth_token = state.authToken;
        }
        const response = await fetch(`${API_URL}?action=${encodeURIComponent(action)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyObj),
        });
        const data = await response.json();
        if (!response.ok || data.ok === false) {
            if (data.code === 'UNAUTHORIZED') {
                handleUnauthenticated();
            }
            const err = new Error(data.error || `Request failed (${response.status})`);
            err.code = data.code;
            throw err;
        }
        return data;
    }

    // ======================= AUTHENTICATION FLOW =======================
    function bindAuthEvents() {
        dom.tabBtnLogin.addEventListener('click', () => switchAuthTab('login'));
        dom.tabBtnRegister.addEventListener('click', () => switchAuthTab('register'));

        dom.regUsername.addEventListener('input', () => {
            if (!state.regAvatarDataUrl) {
                dom.regAvatarPreview.textContent = getInitials(dom.regUsername.value || 'U');
            }
        });

        dom.regAvatarInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            try {
                const dataUrl = await resizeImageFileToDataUrl(file, 160);
                state.regAvatarDataUrl = dataUrl;
                dom.regAvatarPreview.innerHTML = `<img src="${escapeHtml(dataUrl)}" class="avatar-img large" alt="Avatar">`;
                dom.regAvatarClear.classList.remove('hidden');
            } catch (err) {
                showToast(err.message, 'error');
            }
        });

        dom.regAvatarClear.addEventListener('click', () => {
            state.regAvatarDataUrl = '';
            dom.regAvatarInput.value = '';
            dom.regAvatarPreview.innerHTML = '';
            dom.regAvatarPreview.textContent = getInitials(dom.regUsername.value || 'U');
            dom.regAvatarClear.classList.add('hidden');
        });

        dom.loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            dom.loginSubmitBtn.disabled = true;
            try {
                const res = await apiRequest('login', {
                    identifier: dom.loginIdentifier.value.trim(),
                    password: dom.loginPassword.value,
                });
                state.authToken = res.authToken;
                state.user = res.user;
                localStorage.setItem('pulsechat_token', state.authToken);
                await enterWorkspace();
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                dom.loginSubmitBtn.disabled = false;
            }
        });

        dom.registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            dom.registerSubmitBtn.disabled = true;
            try {
                const res = await apiRequest('register', {
                    username: dom.regUsername.value.trim(),
                    email: dom.regEmail.value.trim(),
                    password: dom.regPassword.value,
                    avatar_url: state.regAvatarDataUrl,
                });
                state.authToken = res.authToken;
                state.user = res.user;
                localStorage.setItem('pulsechat_token', state.authToken);
                showToast(`Welcome to Stargazer Chat, ${res.user.username}!`, 'success');
                await enterWorkspace();
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                dom.registerSubmitBtn.disabled = false;
            }
        });
    }

    function switchAuthTab(mode) {
        const isLogin = mode === 'login';
        dom.tabBtnLogin.classList.toggle('active', isLogin);
        dom.tabBtnRegister.classList.toggle('active', !isLogin);
        dom.loginForm.classList.toggle('hidden', !isLogin);
        dom.registerForm.classList.toggle('hidden', isLogin);
        dom.authSubtitle.textContent = isLogin
            ? 'Sign in to your account to continue'
            : 'Create an account to start chatting with friends';
    }

    function handleUnauthenticated(reason = '') {
        state.authToken = '';
        state.user = null;
        localStorage.removeItem('pulsechat_token');
        clearInterval(state.syncTimer);
        closeMobileSidebar();
        closeMobileMembers();
        stopLocalMediaTracks();
        dom.workspaceScreen.classList.add('hidden');
        dom.settingsModal.classList.add('hidden');
        if (dom.adminModal) dom.adminModal.classList.add('hidden');
        if (dom.adminRenameModal) dom.adminRenameModal.classList.add('hidden');
        if (dom.adminBanModal) dom.adminBanModal.classList.add('hidden');
        if (dom.adminDeleteModal) dom.adminDeleteModal.classList.add('hidden');
        if (dom.openAdminBtn) dom.openAdminBtn.classList.add('hidden');
        if (dom.settingsAdminBlock) dom.settingsAdminBlock.classList.add('hidden');
        dom.authScreen.classList.remove('hidden');
        if (reason) {
            showToast(reason, 'info');
        }
    }

    // ======================= WORKSPACE INITIALIZATION =======================
    async function enterWorkspace() {
        try {
            const res = await apiRequest('bootstrap', {
                active_room_id: state.activeTextRoomId,
            });

            state.user = res.user;
            state.channels = res.channels || [];
            state.contacts = res.contacts || [];
            state.members = res.members || [];
            state.activeTextRoomId = res.activeRoomId || 'general';
            state.activeTextRoomType = 'channel';
            state.activeTextRoomTitle = state.activeTextRoomId;
            markRoomMentionsRead(state.activeTextRoomId);

            dom.authScreen.classList.add('hidden');
            dom.workspaceScreen.classList.remove('hidden');

            renderCurrentUserBar();
            renderContactsList();
            renderChannelsList();
            renderMembersList();
            updateActiveRoomHeader();
            syncMediaControlsUI();

            resetAndRenderMessages(res.messages || []);

            if (Array.isArray(res.invites) && res.invites.length > 0) {
                handleIncomingInvites(res.invites);
            }

            // Note: We do NOT access camera or microphone on workspace load.
            // Media is only acquired when a voice/video call starts or when tested in Settings.
            await populateDeviceSelectors();

            clearInterval(state.syncTimer);
            state.syncTimer = setInterval(() => syncWorkspace(), SYNC_INTERVAL_MS);
            startAudioMonitorLoop();
        } catch (err) {
            if (err.code === 'UNAUTHORIZED') {
                handleUnauthenticated(err.message || 'Session expired. Please sign in again.');
            } else {
                showToast(`Unable to connect: ${err.message}`, 'error');
            }
        }
    }

    function saveUnreadMentions() {
        try {
            localStorage.setItem('stargazer_unread_mentions', JSON.stringify(state.unreadMentions));
        } catch (e) {}
    }

    function markRoomMentionsRead(roomId) {
        if (!roomId) return;
        if (state.unreadMentions[roomId]) {
            delete state.unreadMentions[roomId];
            saveUnreadMentions();
            renderChannelsList();
            renderContactsList();
        }
    }

    function renderCurrentUserBar() {
        if (!state.user) return;
        const status = state.user.status || 'online';
        const statusLabel = status === 'dnd' ? 'Do Not Disturb' : (status === 'away' ? 'Away' : 'Online');

        dom.currentUserAvatar.innerHTML = `
            ${renderAvatarMarkup(state.user.username, state.user.avatarColor, state.user.avatarUrl)}
            <span class="status-dot ${status}"></span>
        `;
        dom.currentUserName.textContent = state.user.username;
        if (dom.currentUserStatus) {
            dom.currentUserStatus.textContent = statusLabel;
        }

        if (dom.userStatusMenu) {
            dom.userStatusMenu.querySelectorAll('[data-status-opt]').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-status-opt') === status);
            });
        }

        dom.settingsCurrentAvatar.innerHTML = renderAvatarMarkup(state.user.username, state.user.avatarColor, state.user.avatarUrl, 'large');
        dom.settingsPreviewAvatar.innerHTML = renderAvatarMarkup(state.user.username, state.user.avatarColor, state.user.avatarUrl, 'large');
        dom.settingsUserLabel.textContent = state.user.username;
        dom.settingsEmailLabel.textContent = state.user.email;

        const isAdmin = Boolean(state.user.isAdmin);
        if (dom.openAdminBtn) dom.openAdminBtn.classList.toggle('hidden', !isAdmin);
        if (dom.settingsAdminBlock) dom.settingsAdminBlock.classList.toggle('hidden', !isAdmin);
    }

    // ======================= CONTACTS, CHANNELS & GROUP MEMBER LIST =======================
    function renderContactsList() {
        const onlineCount = state.contacts.filter(c => c.online).length;
        dom.contactsOnlineCounter.textContent = `(${onlineCount} online)`;

        if (state.contacts.length === 0) {
            dom.contactsList.innerHTML = `<div class="nav-item-sub" style="padding:8px;">No contacts yet. Click + to add a friend.</div>`;
            return;
        }

        dom.contactsList.innerHTML = state.contacts.map(c => {
            const isActive = state.activeTextRoomType === 'dm' && state.activeTextRoomId === c.dmRoomId;
            const statusClass = c.online ? (c.status || 'online') : 'offline';
            const statusLabel = c.online
                ? (c.status === 'dnd' ? 'Do Not Disturb' : (c.status === 'away' ? 'Away' : 'Online'))
                : 'Offline';
            const subText = c.online
                ? (c.currentRoom ? (c.currentRoom.startsWith('dm-') ? 'In a call' : `In #${c.currentRoom}`) : statusLabel)
                : 'Offline';

            const hasMention = (state.unreadMentions[c.dmRoomId] || 0) > 0;
            const mentionLedHtml = hasMention ? `<span class="mention-led" title="New mention"></span>` : '';

            return `
                <div class="nav-item ${isActive ? 'active' : ''}" data-dm-select="${escapeHtml(c.userId)}">
                    <div class="nav-item-left">
                        <div class="avatar-wrap">
                            ${renderAvatarMarkup(c.username, c.avatarColor, c.avatarUrl)}
                            <span class="status-dot ${statusClass}"></span>
                        </div>
                        <div style="min-width:0;">
                            <div class="nav-item-title">${escapeHtml(c.username)} ${mentionLedHtml}</div>
                            <div class="nav-item-sub">${escapeHtml(subText)}</div>
                        </div>
                    </div>
                    <div class="nav-item-actions">
                        <button type="button" class="mini-action-btn" data-contact-voice="${escapeHtml(c.userId)}" title="Voice Call ${escapeHtml(c.username)}">📞</button>
                        <button type="button" class="mini-action-btn" data-contact-video="${escapeHtml(c.userId)}" title="Video Call ${escapeHtml(c.username)}">📹</button>
                        <button type="button" class="mini-action-btn delete" data-contact-remove="${escapeHtml(c.userId)}" title="Remove Friend">✕</button>
                    </div>
                </div>
            `;
        }).join('');

        dom.contactsList.querySelectorAll('[data-dm-select]').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                const uid = row.getAttribute('data-dm-select');
                const contact = state.contacts.find(c => c.userId === uid);
                if (contact) selectDirectMessage(contact);
            });
        });

        dom.contactsList.querySelectorAll('[data-contact-voice]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const uid = btn.getAttribute('data-contact-voice');
                const contact = state.contacts.find(c => c.userId === uid);
                if (contact) {
                    await selectDirectMessage(contact);
                    await callContact(contact, false);
                }
            });
        });

        dom.contactsList.querySelectorAll('[data-contact-video]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const uid = btn.getAttribute('data-contact-video');
                const contact = state.contacts.find(c => c.userId === uid);
                if (contact) {
                    await selectDirectMessage(contact);
                    await callContact(contact, true);
                }
            });
        });

        dom.contactsList.querySelectorAll('[data-contact-remove]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const uid = btn.getAttribute('data-contact-remove');
                await removeContact(uid);
            });
        });
    }

    function renderChannelsList() {
        const canDelete = state.channels.length > 1;
        dom.channelsList.innerHTML = state.channels.map(ch => {
            const isActive = state.activeTextRoomType === 'channel' && state.activeTextRoomId === ch.channelId;
            const voicePeers = ch.voicePeers || ch.voiceParticipants || [];

            const hasMention = (state.unreadMentions[ch.channelId] || 0) > 0;
            const mentionLedHtml = hasMention ? `<span class="mention-led" title="New mention in #${escapeHtml(ch.name)}"></span>` : '';

            const voicePeersHtml = voicePeers.length > 0 ? `
                <div class="channel-voice-peers">
                    ${voicePeers.map(vp => `
                        <div class="voice-peer-row">
                            ${renderAvatarMarkup(vp.username, vp.avatarColor, vp.avatarUrl)}
                            <span>${escapeHtml(vp.username)}</span>
                            ${!vp.micEnabled ? '<span title="Muted">🔇</span>' : ''}
                            ${vp.camEnabled ? '<span title="Video On">📹</span>' : ''}
                        </div>
                    `).join('')}
                </div>
            ` : '';

            return `
                <div class="channel-block">
                    <div class="nav-item ${isActive ? 'active' : ''}" data-channel-select="${escapeHtml(ch.channelId)}">
                        <div class="nav-item-left">
                            <span class="channel-hash">#</span>
                            <span class="nav-item-title">${escapeHtml(ch.name)}</span>
                            ${mentionLedHtml}
                        </div>
                        <div class="nav-item-actions">
                            <button type="button" class="mini-action-btn" data-channel-call="${escapeHtml(ch.channelId)}" title="Join Call in #${escapeHtml(ch.name)}">🔊</button>
                            ${canDelete ? `<button type="button" class="mini-action-btn delete" data-channel-delete="${escapeHtml(ch.channelId)}" title="Delete Channel">🗑</button>` : ''}
                        </div>
                    </div>
                    ${voicePeersHtml}
                </div>
            `;
        }).join('');

        dom.channelsList.querySelectorAll('[data-channel-select]').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                const cid = row.getAttribute('data-channel-select');
                selectChannel(cid);
            });
        });

        dom.channelsList.querySelectorAll('[data-channel-call]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const cid = btn.getAttribute('data-channel-call');
                await selectChannel(cid);
                await startOrJoinCall(cid, `#${cid}`, true);
            });
        });

        dom.channelsList.querySelectorAll('[data-channel-delete]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const cid = btn.getAttribute('data-channel-delete');
                await deleteChannel(cid);
            });
        });
    }

    function renderMembersList() {
        // Show right-hand member list in group channels
        const showSidebar = state.activeTextRoomType === 'channel' && state.membersSidebarVisible;
        dom.membersSidebar.classList.toggle('hidden', !showSidebar);
        dom.toggleMembersBtn.classList.toggle('hidden', state.activeTextRoomType !== 'channel');

        if (!showSidebar) return;

        const contactIds = new Set(state.contacts.map(c => c.userId));
        const onlineMembers = state.members.filter(m => m.online);
        const offlineMembers = state.members.filter(m => !m.online);

        const renderMemberItem = (m) => {
            const isSelf = state.user && m.userId === state.user.userId;
            const isContact = contactIds.has(m.userId);
            const statusClass = m.online ? (m.status || 'online') : 'offline';
            const statusLabel = m.online
                ? (m.status === 'dnd' ? 'Do Not Disturb' : (m.status === 'away' ? 'Away' : 'Online'))
                : 'Offline';
            const subText = m.online
                ? (m.currentRoom ? (m.currentRoom.startsWith('dm-') ? 'In a call' : `In #${m.currentRoom}`) : (isSelf ? `You · ${statusLabel}` : statusLabel))
                : 'Offline';

            const actionsHtml = !isSelf ? `
                <div class="member-actions">
                    ${!isContact ? `<button type="button" class="mini-action-btn" data-member-add="${escapeHtml(m.username)}" title="Add Friend">➕</button>` : ''}
                    <button type="button" class="mini-action-btn" data-member-dm="${escapeHtml(m.userId)}" title="Direct Message">💬</button>
                    <button type="button" class="mini-action-btn" data-member-call="${escapeHtml(m.userId)}" title="Video Call">📹</button>
                </div>
            ` : '';

            return `
                <div class="member-row ${m.online ? 'online' : 'offline'}" data-member-row="${escapeHtml(m.userId)}">
                    <div class="member-row-left">
                        <div class="avatar-wrap">
                            ${renderAvatarMarkup(m.username, m.avatarColor, m.avatarUrl)}
                            <span class="status-dot ${statusClass}"></span>
                        </div>
                        <div style="min-width:0;">
                            <div class="member-name">${escapeHtml(m.username)}${isSelf ? ' (You)' : ''}${m.isAdmin ? ' <span class="badge-admin">Admin</span>' : ''}</div>
                            <div class="member-sub">${escapeHtml(subText)}</div>
                        </div>
                    </div>
                    ${actionsHtml}
                </div>
            `;
        };

        let html = '';
        if (onlineMembers.length > 0) {
            html += `
                <div class="member-group">
                    <div class="member-group-title">Online — ${onlineMembers.length}</div>
                    ${onlineMembers.map(renderMemberItem).join('')}
                </div>
            `;
        }
        if (offlineMembers.length > 0) {
            html += `
                <div class="member-group">
                    <div class="member-group-title">Offline — ${offlineMembers.length}</div>
                    ${offlineMembers.map(renderMemberItem).join('')}
                </div>
            `;
        }

        dom.membersList.innerHTML = html;

        dom.membersList.querySelectorAll('[data-member-add]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await addContact(btn.getAttribute('data-member-add'));
            });
        });

        dom.membersList.querySelectorAll('[data-member-dm]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const uid = btn.getAttribute('data-member-dm');
                const member = state.members.find(m => m.userId === uid);
                if (member) await selectDirectMessage(member);
            });
        });

        dom.membersList.querySelectorAll('[data-member-call]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const uid = btn.getAttribute('data-member-call');
                const member = state.members.find(m => m.userId === uid);
                if (member) {
                    await selectDirectMessage(member);
                    await callContact(member, true);
                }
            });
        });

        dom.membersList.querySelectorAll('[data-member-row]').forEach(row => {
            row.addEventListener('click', async (e) => {
                if (e.target.closest('button')) return;
                const uid = row.getAttribute('data-member-row');
                if (state.user && uid === state.user.userId) return;
                const member = state.members.find(m => m.userId === uid);
                if (member) await selectDirectMessage(member);
            });
        });
    }

    // ======================= MOBILE NAVIGATION DRAWER HELPERS =======================
    function openMobileSidebar() {
        if (dom.mainSidebar) dom.mainSidebar.classList.add('open');
        if (dom.mobileSidebarBackdrop) dom.mobileSidebarBackdrop.classList.remove('hidden');
        closeMobileMembers();
    }

    function closeMobileSidebar() {
        if (dom.mainSidebar) dom.mainSidebar.classList.remove('open');
        if (dom.mobileSidebarBackdrop) dom.mobileSidebarBackdrop.classList.add('hidden');
    }

    function openMobileMembers() {
        if (dom.membersSidebar) dom.membersSidebar.classList.add('open');
        if (dom.mobileMembersBackdrop) dom.mobileMembersBackdrop.classList.remove('hidden');
        closeMobileSidebar();
    }

    function closeMobileMembers() {
        if (dom.membersSidebar) dom.membersSidebar.classList.remove('open');
        if (dom.mobileMembersBackdrop) dom.mobileMembersBackdrop.classList.add('hidden');
    }

    async function selectChannel(channelId) {
        closeMobileSidebar();
        closeMobileMembers();
        const ch = state.channels.find(c => c.channelId === channelId);
        state.activeTextRoomId = channelId;
        state.activeTextRoomType = 'channel';
        state.activeTextRoomTitle = ch ? ch.name : channelId;
        state.activeDmContact = null;
        state.leftChannelCallId = null;

        markRoomMentionsRead(channelId);
        renderContactsList();
        renderChannelsList();
        renderMembersList();
        updateActiveRoomHeader();

        const voicePeers = ch ? (ch.voicePeers || ch.voiceParticipants || []) : [];
        if (voicePeers.length > 0 && !state.inCall && !state.outgoingCall && !state.activeIncomingInvite) {
            startOrJoinCall(ch.channelId, `#${ch.name}`, false, true).catch(() => {});
        }

        try {
            const res = await apiRequest('switch_text_room', { room_id: channelId });
            resetAndRenderMessages(res.messages || []);
        } catch (err) {
            showToast('Could not load channel messages', 'error');
        }
    }

    async function selectDirectMessage(contact) {
        closeMobileSidebar();
        closeMobileMembers();
        state.activeTextRoomId = contact.dmRoomId;
        state.activeTextRoomType = 'dm';
        state.activeTextRoomTitle = contact.username;
        state.activeDmContact = contact;

        markRoomMentionsRead(contact.dmRoomId);
        renderContactsList();
        renderChannelsList();
        renderMembersList();
        updateActiveRoomHeader();

        try {
            const res = await apiRequest('switch_text_room', { room_id: contact.dmRoomId });
            resetAndRenderMessages(res.messages || []);
        } catch (err) {
            showToast('Could not load conversation', 'error');
        }
    }

    function updateActiveRoomHeader() {
        if (state.activeTextRoomType === 'dm' && state.activeDmContact) {
            dom.roomPrefixIcon.textContent = '@';
            dom.activeRoomTitle.textContent = state.activeDmContact.username;
            dom.activeRoomSubtitle.textContent = state.activeDmContact.online ? 'Online' : 'Offline';
            dom.chatInput.placeholder = `Message @${state.activeDmContact.username}`;
        } else {
            dom.roomPrefixIcon.textContent = '#';
            dom.activeRoomTitle.textContent = state.activeTextRoomTitle;
            dom.activeRoomSubtitle.textContent = 'Group Channel';
            dom.chatInput.placeholder = `Message #${state.activeTextRoomTitle}`;
        }
    }

    async function createNewChannel(rawName) {
        const name = rawName.trim();
        if (!name) return;
        try {
            const res = await apiRequest('create_channel', { name });
            state.channels = res.channels || [];
            dom.createChannelForm.classList.add('hidden');
            dom.newChannelInput.value = '';
            await selectChannel(res.channelId);
            showToast(`Channel #${res.channelId} created!`, 'success');
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    async function deleteChannel(channelId) {
        try {
            const res = await apiRequest('delete_channel', { channel_id: channelId });
            state.channels = res.channels || [];
            if (state.inCall && state.callRoomId === channelId) {
                await leaveCall();
            }
            if (state.activeTextRoomType === 'channel' && state.activeTextRoomId === channelId) {
                const nextChannel = state.channels[0] ? state.channels[0].channelId : 'general';
                await selectChannel(nextChannel);
            } else {
                renderChannelsList();
            }
            showToast(`Deleted #${channelId}`, 'info');
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    async function addContact(usernameOrEmail) {
        const query = usernameOrEmail.trim();
        if (!query) return;
        try {
            const res = await apiRequest('add_contact', { friend_username: query });
            state.contacts = res.contacts || [];
            dom.addContactForm.classList.add('hidden');
            dom.addContactInput.value = '';
            renderContactsList();
            renderMembersList();
            showToast(`Added ${res.friendName} to your contacts!`, 'success');
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    async function removeContact(friendId) {
        try {
            const res = await apiRequest('remove_contact', { friend_id: friendId });
            state.contacts = res.contacts || [];
            renderContactsList();
            renderMembersList();
            if (state.activeDmContact && state.activeDmContact.userId === friendId) {
                const firstChannel = state.channels[0] ? state.channels[0].channelId : 'general';
                await selectChannel(firstChannel);
            }
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    async function setUserStatus(status, isAuto = false) {
        if (!['online', 'away', 'dnd'].includes(status)) status = 'online';
        if (state.user) {
            state.user.status = status;
        }
        state.autoAway = isAuto;
        renderCurrentUserBar();
        try {
            await apiRequest('set_status', { status });
        } catch (e) {}
    }

    function initInactivityTracker() {
        const onActivity = () => {
            state.lastUserInteraction = Date.now();
            if (state.autoAway && state.user && state.user.status === 'away') {
                setUserStatus('online');
            }
        };

        window.addEventListener('mousemove', onActivity, { passive: true });
        window.addEventListener('mousedown', onActivity, { passive: true });
        window.addEventListener('keydown', onActivity, { passive: true });
        window.addEventListener('touchstart', onActivity, { passive: true });
        window.addEventListener('scroll', onActivity, { passive: true });

        setInterval(() => {
            if (!state.user || state.user.status !== 'online') return;
            const idleTime = Date.now() - state.lastUserInteraction;
            if (idleTime >= 15 * 60 * 1000) { // 15 minutes inactivity
                setUserStatus('away', true);
            }
        }, 10000);
    }

    async function callContact(contact, withVideo = true) {
        if (state.inCall) {
            await leaveCall();
        }
        try {
            const res = await apiRequest('send_invite', {
                target_user_id: contact.userId,
                room_id: contact.dmRoomId,
                room_label: `Call with ${state.user.username}`,
                mode: withVideo ? 'video' : 'voice',
            });

            state.outgoingCall = {
                inviteId: res.inviteId,
                contact,
                mode: withVideo ? 'video' : 'voice',
                roomId: res.roomId,
                countdown: 30,
            };

            if (dom.outgoingCallAvatar) {
                dom.outgoingCallAvatar.innerHTML = renderAvatarMarkup(contact.username, contact.avatarColor, contact.avatarUrl, 'large');
            }
            if (dom.outgoingCallTitle) {
                dom.outgoingCallTitle.textContent = `Calling ${contact.username}...`;
            }
            if (dom.outgoingCallSubtitle) {
                dom.outgoingCallSubtitle.textContent = `Ringing... Waiting for ${contact.username} to accept`;
            }
            if (dom.outgoingCallTimer) {
                dom.outgoingCallTimer.textContent = '0:30';
            }
            if (dom.outgoingCallModal) {
                dom.outgoingCallModal.classList.remove('hidden');
            }

            playOutgoingRing();

            if (state.activeOutgoingTimer) clearInterval(state.activeOutgoingTimer);
            state.activeOutgoingTimer = setInterval(async () => {
                if (!state.outgoingCall) {
                    clearInterval(state.activeOutgoingTimer);
                    return;
                }
                state.outgoingCall.countdown--;
                const sec = state.outgoingCall.countdown;
                if (dom.outgoingCallTimer) {
                    dom.outgoingCallTimer.textContent = `0:${sec < 10 ? '0' : ''}${sec}`;
                }
                if (sec <= 0) {
                    clearInterval(state.activeOutgoingTimer);
                    await cancelOutgoingCall(true);
                }
            }, 1000);
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    async function cancelOutgoingCall(isTimeout = false) {
        stopRingtone();
        if (state.activeOutgoingTimer) {
            clearInterval(state.activeOutgoingTimer);
            state.activeOutgoingTimer = null;
        }
        if (dom.outgoingCallModal) dom.outgoingCallModal.classList.add('hidden');

        const current = state.outgoingCall;
        state.outgoingCall = null;

        if (current && current.inviteId) {
            try {
                await apiRequest('respond_invite', {
                    invite_id: current.inviteId,
                    action: 'cancel',
                });
            } catch (e) {}
        }

        if (isTimeout && current) {
            showToast(`No answer from ${current.contact.username}. Call ended.`, 'info');
        }
    }

    function handleIncomingInvites(invites) {
        const latest = invites[invites.length - 1];
        if (!latest || latest.status !== 'pending') return;
        if (state.inCall && state.callRoomId === latest.roomId) return;
        if (state.activeIncomingInvite && state.activeIncomingInvite.id === latest.id) return;

        state.activeIncomingInvite = latest;
        latest.countdown = 30;

        dom.inviteAvatarWrap.innerHTML = renderAvatarMarkup(latest.senderName, latest.senderColor, latest.senderAvatar, 'large');
        dom.inviteTitle.textContent = `${latest.senderName} is calling you`;
        dom.inviteSubtitle.textContent = latest.mode === 'voice' ? 'Incoming Voice Call' : 'Incoming Video Call';
        if (dom.inviteTimer) dom.inviteTimer.textContent = '0:30';
        dom.inviteModal.classList.remove('hidden');

        playIncomingRing();

        if (state.notifications.calls && (!state.user || state.user.status !== 'dnd')) {
            dispatchSystemNotification({
                title: `📞 Incoming Call from ${latest.senderName}`,
                body: `${latest.senderName} is calling you (${latest.mode} call). Click to answer.`,
                tag: `call-invite-${latest.senderId}`,
                onClick: () => {
                    window.focus();
                    dom.inviteModal.classList.remove('hidden');
                }
            });
        }

        if (state.activeIncomingTimer) clearInterval(state.activeIncomingTimer);
        state.activeIncomingTimer = setInterval(async () => {
            if (!state.activeIncomingInvite) {
                clearInterval(state.activeIncomingTimer);
                return;
            }
            state.activeIncomingInvite.countdown--;
            const sec = state.activeIncomingInvite.countdown;
            if (dom.inviteTimer) {
                dom.inviteTimer.textContent = `0:${sec < 10 ? '0' : ''}${sec}`;
            }
            if (sec <= 0) {
                clearInterval(state.activeIncomingTimer);
                await declineIncomingCall(true);
            }
        }, 1000);
    }

    async function acceptIncomingCall(withVideo = true) {
        stopRingtone();
        if (state.activeIncomingTimer) {
            clearInterval(state.activeIncomingTimer);
            state.activeIncomingTimer = null;
        }
        dom.inviteModal.classList.add('hidden');
        const inv = state.activeIncomingInvite;
        state.activeIncomingInvite = null;
        if (!inv) return;

        try {
            await apiRequest('respond_invite', {
                invite_id: inv.id,
                action: 'accept',
            });
            await startOrJoinCall(inv.roomId, inv.roomLabel || 'Call', withVideo);
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    async function declineIncomingCall(isTimeout = false) {
        stopRingtone();
        if (state.activeIncomingTimer) {
            clearInterval(state.activeIncomingTimer);
            state.activeIncomingTimer = null;
        }
        dom.inviteModal.classList.add('hidden');
        const inv = state.activeIncomingInvite;
        state.activeIncomingInvite = null;
        if (!inv) return;

        try {
            await apiRequest('respond_invite', {
                invite_id: inv.id,
                action: 'decline',
            });
        } catch (e) {}

        if (isTimeout) {
            showToast('Call timed out after 30 seconds.', 'info');
        }
    }

    function setupMentionAutocomplete() {
        if (!dom.chatInput || !dom.mentionSuggestions) return;

        let selectedIndex = 0;
        let currentMatches = [];

        function closeSuggestions() {
            dom.mentionSuggestions.classList.add('hidden');
            dom.mentionSuggestions.innerHTML = '';
            currentMatches = [];
            selectedIndex = 0;
        }

        function getMentionQuery() {
            const text = dom.chatInput.value.slice(0, dom.chatInput.selectionStart);
            const match = text.match(/@([a-zA-Z0-9_-]*)$/);
            return match ? { query: match[1].toLowerCase(), index: match.index } : null;
        }

        function renderSuggestions(matches) {
            currentMatches = matches;
            if (matches.length === 0) {
                closeSuggestions();
                return;
            }
            selectedIndex = Math.min(selectedIndex, matches.length - 1);
            dom.mentionSuggestions.innerHTML = matches.map((m, idx) => `
                <div class="mention-item ${idx === selectedIndex ? 'selected' : ''}" data-mention-user="${escapeHtml(m.username)}">
                    <div class="avatar-wrap mini">
                        ${renderAvatarMarkup(m.username, m.avatarColor, m.avatarUrl)}
                        <span class="status-dot ${m.online ? (m.status || 'online') : 'offline'}"></span>
                    </div>
                    <span class="mention-item-name">${escapeHtml(m.username)}</span>
                    <span class="mention-item-tag">@${escapeHtml(m.username)}</span>
                </div>
            `).join('');

            dom.mentionSuggestions.querySelectorAll('[data-mention-user]').forEach((el, idx) => {
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    insertMention(matches[idx].username);
                });
            });

            dom.mentionSuggestions.classList.remove('hidden');
        }

        function insertMention(username) {
            const cursorPos = dom.chatInput.selectionStart;
            const text = dom.chatInput.value;
            const match = text.slice(0, cursorPos).match(/@([a-zA-Z0-9_-]*)$/);
            if (!match) return;

            const before = text.slice(0, match.index);
            const after = text.slice(cursorPos);
            dom.chatInput.value = `${before}@${username} ${after}`;
            const newCursor = match.index + username.length + 2;
            dom.chatInput.setSelectionRange(newCursor, newCursor);
            dom.chatInput.focus();
            closeSuggestions();
        }

        dom.chatInput.addEventListener('input', () => {
            const mq = getMentionQuery();
            if (!mq) {
                closeSuggestions();
                return;
            }
            const allUsers = [...state.members, ...state.contacts];
            const seen = new Set();
            const uniqueUsers = allUsers.filter(u => {
                if (state.user && u.userId === state.user.userId) return false;
                if (seen.has(u.username.toLowerCase())) return false;
                seen.add(u.username.toLowerCase());
                return true;
            });

            const matches = uniqueUsers.filter(u => u.username.toLowerCase().startsWith(mq.query)).slice(0, 5);
            renderSuggestions(matches);
        });

        dom.chatInput.addEventListener('keydown', (e) => {
            if (dom.mentionSuggestions.classList.contains('hidden') || currentMatches.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = (selectedIndex + 1) % currentMatches.length;
                renderSuggestions(currentMatches);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = (selectedIndex - 1 + currentMatches.length) % currentMatches.length;
                renderSuggestions(currentMatches);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertMention(currentMatches[selectedIndex].username);
            } else if (e.key === 'Escape') {
                closeSuggestions();
            }
        });

        document.addEventListener('click', (e) => {
            if (!dom.mentionSuggestions.contains(e.target) && e.target !== dom.chatInput) {
                closeSuggestions();
            }
        });
    }

    // ======================= ON-DEMAND MEDIA & SETTINGS MODAL =======================
    async function acquireLocalMedia(needVideo = true) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            state.camEnabled = false;
            state.micEnabled = false;
            syncMediaControlsUI();
            return;
        }

        const audioSource = dom.settingsAudioSource ? dom.settingsAudioSource.value : '';
        const videoSource = dom.settingsVideoSource ? dom.settingsVideoSource.value : '';

        const audioConstraints = audioSource
            ? { deviceId: { ideal: audioSource }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

        const videoConstraints = videoSource
            ? { deviceId: { ideal: videoSource }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }
            : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } };

        try {
            if (state.localStream) {
                state.localStream.getTracks().forEach(t => t.stop());
            }

            let stream = null;
            if (needVideo) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: videoConstraints });
                } catch (bothErr) {
                    try {
                        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
                        state.camEnabled = false;
                    } catch (audioErr) {
                        stream = new MediaStream();
                        state.micEnabled = false;
                        state.camEnabled = false;
                    }
                }
            } else {
                // Voice-only call requested: only ask for microphone unless user turns camera on
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
                    state.camEnabled = false;
                } catch (audioErr) {
                    stream = new MediaStream();
                    state.micEnabled = false;
                    state.camEnabled = false;
                }
            }

            state.localStream = stream;
            state.localStream.getAudioTracks().forEach(t => { t.enabled = state.micEnabled; });
            state.localStream.getVideoTracks().forEach(t => { t.enabled = state.camEnabled; });

            dom.settingsVideoPreview.srcObject = state.localStream;
            setupLocalAudioAnalyser(state.localStream);
            await populateDeviceSelectors();
            syncMediaControlsUI();

            if (state.inCall) {
                updateLocalTileStream();
                replaceOutgoingTracks();
            }
        } catch (err) {
            syncMediaControlsUI();
        }
    }

    function stopLocalMediaTracks() {
        if (state.localStream) {
            state.localStream.getTracks().forEach(t => t.stop());
            state.localStream = null;
        }
        state.localAnalyser = null;
        dom.settingsVideoPreview.srcObject = null;
        syncMediaControlsUI();
    }

    async function populateDeviceSelectors() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();

            const currentAudio = dom.settingsAudioSource.value;
            const currentVideo = dom.settingsVideoSource.value;

            dom.settingsAudioSource.innerHTML = '';
            dom.settingsVideoSource.innerHTML = '';

            let micIndex = 1;
            let camIndex = 1;

            devices.forEach(dev => {
                if (dev.kind === 'audioinput') {
                    const opt = document.createElement('option');
                    opt.value = dev.deviceId;
                    opt.textContent = dev.label || `Microphone ${micIndex++}`;
                    dom.settingsAudioSource.appendChild(opt);
                } else if (dev.kind === 'videoinput') {
                    const opt = document.createElement('option');
                    opt.value = dev.deviceId;
                    opt.textContent = dev.label || `Camera ${camIndex++}`;
                    dom.settingsVideoSource.appendChild(opt);
                }
            });

            if (currentAudio && [...dom.settingsAudioSource.options].some(o => o.value === currentAudio)) {
                dom.settingsAudioSource.value = currentAudio;
            }
            if (currentVideo && [...dom.settingsVideoSource.options].some(o => o.value === currentVideo)) {
                dom.settingsVideoSource.value = currentVideo;
            }
        } catch (e) {}
    }

    function setupLocalAudioAnalyser(stream) {
        if (!stream || stream.getAudioTracks().length === 0) {
            state.localAnalyser = null;
            return;
        }
        try {
            if (!state.audioContext) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                state.audioContext = new AudioCtx();
            }
            const source = state.audioContext.createMediaStreamSource(stream);
            const analyser = state.audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.75;
            source.connect(analyser);
            state.localAnalyser = analyser;
        } catch (e) {}
    }

    function computeAudioLevel(analyser) {
        if (!analyser) return 0;
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        return Math.min(100, Math.round((avg / 110) * 100));
    }

    function startAudioMonitorLoop() {
        const tick = () => {
            const localLevel = state.micEnabled ? computeAudioLevel(state.localAnalyser) : 0;
            if (state.settingsOpen) {
                dom.settingsMicLevel.style.width = `${localLevel}%`;
            }
            if (state.inCall) {
                const localTile = document.getElementById(`tile-${state.peerId}`);
                if (localTile) {
                    localTile.classList.toggle('speaking', localLevel > 15);
                }
                state.peers.forEach((session, remotePeerId) => {
                    const remoteParticipant = state.participants.get(remotePeerId);
                    const remoteMicOn = remoteParticipant ? remoteParticipant.micEnabled : true;
                    const level = remoteMicOn ? computeAudioLevel(session.analyser) : 0;
                    const tile = document.getElementById(`tile-${remotePeerId}`);
                    if (tile) {
                        tile.classList.toggle('speaking', level > 15);
                    }
                });
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    function toggleMic() {
        state.micEnabled = !state.micEnabled;
        if (state.localStream) {
            state.localStream.getAudioTracks().forEach(t => { t.enabled = state.micEnabled; });
        }
        syncMediaControlsUI();
        if (state.inCall) {
            updateLocalTileBadges();
            replaceOutgoingTracks();
            broadcastDataChannelControl({
                type: 'media-state',
                micEnabled: state.micEnabled,
                camEnabled: state.camEnabled,
                screenSharing: state.screenSharing,
            });
        }
    }

    async function toggleCam() {
        state.camEnabled = !state.camEnabled;
        // If user turns camera on during a voice-only call and no video track was acquired yet, acquire it now
        if (state.camEnabled && state.inCall && (!state.localStream || state.localStream.getVideoTracks().length === 0)) {
            await acquireLocalMedia(true);
        } else if (state.localStream) {
            state.localStream.getVideoTracks().forEach(t => { t.enabled = state.camEnabled; });
        }
        syncMediaControlsUI();
        if (state.inCall) {
            updateLocalTileBadges();
            replaceOutgoingTracks();
            broadcastDataChannelControl({
                type: 'media-state',
                micEnabled: state.micEnabled,
                camEnabled: state.camEnabled,
                screenSharing: state.screenSharing,
            });
        }
    }

    function syncMediaControlsUI() {
        const hasVideoTrack = Boolean(state.localStream && state.localStream.getVideoTracks().length > 0);
        const showCam = state.camEnabled && hasVideoTrack;

        dom.quickMicBtn.classList.toggle('muted', !state.micEnabled);
        dom.quickMicBtn.querySelector('.icon-mic-on').classList.toggle('hidden', !state.micEnabled);
        dom.quickMicBtn.querySelector('.icon-mic-off').classList.toggle('hidden', state.micEnabled);

        dom.quickCamBtn.classList.toggle('muted', !state.camEnabled);
        dom.quickCamBtn.querySelector('.icon-cam-on').classList.toggle('hidden', !state.camEnabled);
        dom.quickCamBtn.querySelector('.icon-cam-off').classList.toggle('hidden', state.camEnabled);

        dom.settingsAvatarFallback.classList.toggle('hidden', showCam);
        if (dom.settingsCamStatusLabel) {
            dom.settingsCamStatusLabel.textContent = state.localStream
                ? 'Camera is off'
                : 'Camera & Mic activate only during calls (or click Test above)';
        }

        dom.stageMicBtn.textContent = state.micEnabled ? 'Mic On' : 'Muted';
        dom.stageMicBtn.classList.toggle('muted', !state.micEnabled);

        dom.stageCamBtn.textContent = showCam ? 'Video On' : 'Video Off';
        dom.stageCamBtn.classList.toggle('muted', !showCam);

        dom.stageScreenBtn.textContent = state.screenSharing ? 'Stop Share' : 'Share Screen';
        dom.callBarCamBtn.classList.toggle('active', showCam);
        dom.callBarScreenBtn.classList.toggle('active', state.screenSharing);
    }

    // ======================= VOICE & VIDEO CALLS (UP TO 6 PEERS) =======================
    async function startOrJoinCall(roomId, roomLabel, withVideo = true, isAutoConnect = false) {
        if (state.inCall && state.callRoomId === roomId) {
            return;
        }
        if (state.inCall) {
            await leaveCall();
        }

        const isChannel = !roomId.startsWith('dm-');
        const channelObj = isChannel ? state.channels.find(c => c.channelId === roomId) : null;
        const existingPeers = (channelObj && (channelObj.voicePeers || channelObj.voiceParticipants)) ? (channelObj.voicePeers || channelObj.voiceParticipants) : [];
        const isFirstStarter = isChannel ? (existingPeers.length === 0) : true;

        if (isAutoConnect) {
            state.camEnabled = false;
            state.micEnabled = false;
        } else if (isChannel) {
            if (isFirstStarter) {
                state.camEnabled = Boolean(withVideo);
                state.micEnabled = true;
            } else {
                state.camEnabled = false;
                state.micEnabled = false;
                showToast('Connected to channel voice (Microphone muted, camera off)', 'info');
            }
        } else {
            state.camEnabled = Boolean(withVideo);
            state.micEnabled = true;
        }

        closeMobileSidebar();
        closeMobileMembers();

        // Acquire microphone (and camera if video call) ONLY now when call is initiated!
        await acquireLocalMedia(Boolean(state.camEnabled));

        try {
            if (state.audioContext && state.audioContext.state === 'suspended') {
                await state.audioContext.resume();
            }

            const res = await apiRequest('join_call', {
                room_id: roomId,
                peer_id: state.peerId,
                mic_enabled: state.micEnabled,
                cam_enabled: state.camEnabled,
                screen_sharing: state.screenSharing,
            });

            state.inCall = true;
            state.callRoomId = res.roomId;
            state.callRoomLabel = roomLabel || `#${res.roomId}`;
            state.channels = res.channels || state.channels;

            dom.callStage.classList.remove('hidden');
            dom.sidebarCallBar.classList.remove('hidden');
            dom.headerLeaveBtn.classList.remove('hidden');
            dom.callBarRoomName.textContent = state.callRoomLabel;

            ensureVideoTile({
                peerId: state.peerId,
                username: state.user.username,
                avatarColor: state.user.avatarColor,
                avatarUrl: state.user.avatarUrl,
                micEnabled: state.micEnabled,
                camEnabled: state.camEnabled,
                screenSharing: state.screenSharing,
                isLocal: true,
            });

            reconcileCallParticipants(res.participants || []);
            renderChannelsList();
            syncMediaControlsUI();
        } catch (err) {
            stopLocalMediaTracks();
            showToast(err.message || 'Could not join call', 'error');
        }
    }

    async function leaveCall() {
        if (!state.inCall) return;
        state.inCall = false;

        if (state.callRoomId && !state.callRoomId.startsWith('dm-')) {
            state.leftChannelCallId = state.callRoomId;
        }

        if (state.screenSharing) {
            await stopScreenShare(false);
        }

        // Release camera & microphone hardware when call ends
        if (!state.settingsOpen) {
            stopLocalMediaTracks();
        }

        state.peers.forEach((session, pid) => closePeerSession(pid));
        state.peers.clear();
        state.participants.clear();

        const oldCallRoom = state.callRoomId;
        state.callRoomId = '';
        state.callRoomLabel = '';

        dom.videoGrid.innerHTML = '';
        dom.callStage.classList.add('hidden');
        dom.sidebarCallBar.classList.add('hidden');
        dom.headerLeaveBtn.classList.add('hidden');

        try {
            const res = await apiRequest('leave_call', {
                room_id: oldCallRoom,
                peer_id: state.peerId,
            });
            if (res.channels) {
                state.channels = res.channels;
                renderChannelsList();
            }
        } catch (e) {}
    }

    // ======================= PERIODIC WORKSPACE SYNC =======================
    async function syncWorkspace() {
        if (!state.authToken || state.syncInFlight) return;
        state.syncInFlight = true;

        try {
            const res = await apiRequest('sync', {
                text_room_id: state.activeTextRoomId,
                call_room_id: state.inCall ? state.callRoomId : '',
                peer_id: state.peerId,
                last_message_id: state.lastMessageId,
                mic_enabled: state.micEnabled,
                cam_enabled: state.camEnabled,
                screen_sharing: state.screenSharing,
            });

            if (res.user) {
                const wasAdmin = state.user && state.user.isAdmin;
                state.user = res.user;
                if (wasAdmin !== state.user.isAdmin) {
                    renderCurrentUserBar();
                    renderMembersList();
                }
            }

            if (Array.isArray(res.channels)) {
                state.channels = res.channels;
                renderChannelsList();

                // If user is currently in a channel that was deleted by another user:
                if (state.activeTextRoomType === 'channel') {
                    const channelStillExists = state.channels.some(ch => ch.channelId === state.activeTextRoomId);
                    if (!channelStillExists && state.channels.length > 0) {
                        const fallbackChannel = res.activeRoomId || state.channels[0].channelId;
                        showToast(`The channel you were in was deleted. Switched to #${fallbackChannel}.`, 'info');
                        await selectChannel(fallbackChannel);
                    }
                }

                // If user was in a voice call in a channel that was deleted:
                if (state.inCall && !state.callRoomId.startsWith('dm-')) {
                    const callChannelExists = state.channels.some(ch => ch.channelId === state.callRoomId);
                    if (!callChannelExists) {
                        showToast('The voice channel was deleted.', 'error');
                        await leaveCall();
                    }
                }
            }

            if (Array.isArray(res.contacts)) {
                state.contacts = res.contacts;
                renderContactsList();
                if (state.activeDmContact) {
                    const updatedDm = state.contacts.find(c => c.userId === state.activeDmContact.userId);
                    if (updatedDm) {
                        state.activeDmContact = updatedDm;
                        updateActiveRoomHeader();
                    }
                }
            }

            if (Array.isArray(res.members)) {
                state.members = res.members;
                renderMembersList();
            }

            if (Array.isArray(res.invites) && res.invites.length > 0) {
                handleIncomingInvites(res.invites);
            } else if (state.activeIncomingInvite) {
                stopRingtone();
                if (state.activeIncomingTimer) {
                    clearInterval(state.activeIncomingTimer);
                    state.activeIncomingTimer = null;
                }
                if (dom.inviteModal) dom.inviteModal.classList.add('hidden');
                state.activeIncomingInvite = null;
            }

            if (state.outgoingCall && res.outgoingInvite) {
                if (res.outgoingInvite.id === state.outgoingCall.inviteId) {
                    if (res.outgoingInvite.status === 'accepted') {
                        const callInfo = state.outgoingCall;
                        stopRingtone();
                        if (state.activeOutgoingTimer) {
                            clearInterval(state.activeOutgoingTimer);
                            state.activeOutgoingTimer = null;
                        }
                        if (dom.outgoingCallModal) dom.outgoingCallModal.classList.add('hidden');
                        state.outgoingCall = null;
                        showToast(`${callInfo.contact.username} accepted the call! Connecting...`, 'success');
                        await startOrJoinCall(callInfo.roomId, `@${callInfo.contact.username}`, callInfo.mode === 'video');
                    } else if (res.outgoingInvite.status === 'declined') {
                        const callInfo = state.outgoingCall;
                        stopRingtone();
                        if (state.activeOutgoingTimer) {
                            clearInterval(state.activeOutgoingTimer);
                            state.activeOutgoingTimer = null;
                        }
                        if (dom.outgoingCallModal) dom.outgoingCallModal.classList.add('hidden');
                        state.outgoingCall = null;
                        showToast(`${callInfo.contact.username} declined the call.`, 'warning');
                    }
                }
            }

            // Auto-connect to active channel call if in that channel
            if (state.activeTextRoomType === 'channel' && !state.inCall && !state.outgoingCall && !state.activeIncomingInvite) {
                const activeCh = state.channels.find(ch => ch.channelId === state.activeTextRoomId);
                const voicePeers = activeCh ? (activeCh.voicePeers || activeCh.voiceParticipants || []) : [];
                if (voicePeers.length > 0 && state.leftChannelCallId !== activeCh.channelId) {
                    await startOrJoinCall(activeCh.channelId, `#${activeCh.name}`, false, true);
                }
            }

            if (Array.isArray(res.messages) && res.messages.length > 0) {
                res.messages.forEach(msg => {
                    const isNew = !state.renderedMessageIds.has(msg.id);
                    appendChatMessage(msg);
                    if (isNew && state.user && msg.userId !== state.user.userId) {
                        const myName = (state.user.username || '').toLowerCase();
                        const isMentioned = Array.isArray(msg.mentions)
                            ? msg.mentions.some(m => m.toLowerCase() === myName)
                            : (msg.content && msg.content.toLowerCase().includes(`@${myName}`));

                        if (isMentioned) {
                            if (state.activeTextRoomId !== msg.roomId || document.hidden) {
                                state.unreadMentions[msg.roomId] = (state.unreadMentions[msg.roomId] || 0) + 1;
                                saveUnreadMentions();
                                renderChannelsList();
                                renderContactsList();
                            }

                            if (state.user.status !== 'dnd') {
                                playNotificationChime();
                                dispatchSystemNotification({
                                    title: `@${msg.username} mentioned you`,
                                    body: msg.content,
                                    tag: `mention-${msg.id}`,
                                    onClick: () => {
                                        window.focus();
                                        if (msg.roomId.startsWith('dm-')) {
                                            const contact = state.contacts.find(c => c.dmRoomId === msg.roomId);
                                            if (contact) selectDirectMessage(contact);
                                        } else {
                                            selectChannel(msg.roomId);
                                        }
                                    }
                                });
                            }
                        } else {
                            notifyIncomingMessage(msg, state.activeTextRoomId, state.activeTextRoomType, state.activeTextRoomTitle);
                        }
                    }
                });
                scrollToChatBottom();
            }

            if (Array.isArray(res.editedMessages) && res.editedMessages.length > 0) {
                res.editedMessages.forEach(msg => {
                    updateRenderedMessage(msg);
                });
            }

            if (state.inCall) {
                if (Array.isArray(res.callParticipants)) {
                    reconcileCallParticipants(res.callParticipants);
                }
                if (Array.isArray(res.signals)) {
                    for (const sig of res.signals) {
                        await handleIncomingSignal(sig);
                    }
                }
            }
        } catch (err) {
        } finally {
            state.syncInFlight = false;
        }
    }

    function reconcileCallParticipants(serverList) {
        const seenIds = new Set();

        serverList.forEach(p => {
            seenIds.add(p.peerId);
            state.participants.set(p.peerId, p);

            if (p.peerId === state.peerId) {
                updateLocalTileBadges();
                return;
            }

            ensureVideoTile({
                peerId: p.peerId,
                username: p.username,
                avatarColor: p.avatarColor,
                avatarUrl: p.avatarUrl,
                micEnabled: p.micEnabled,
                camEnabled: p.camEnabled,
                screenSharing: p.screenSharing,
                isLocal: false,
            });

            if (!state.peers.has(p.peerId)) {
                createPeerSession(p.peerId);
            } else {
                updateRemoteTileBadges(p.peerId);
            }
        });

        Array.from(state.participants.keys()).forEach(pid => {
            if (!seenIds.has(pid) && pid !== state.peerId) {
                state.participants.delete(pid);
                closePeerSession(pid);
                removeVideoTile(pid);
            }
        });

        updateGridCount();
    }

    // ======================= WEBRTC MESH & RELAY FALLBACK =======================
    function queueSignal(targetId, type, payload) {
        state.signalQueue.push({ target_id: targetId, type, payload });
        if (type === 'description') {
            if (state.signalFlushTimer) {
                clearTimeout(state.signalFlushTimer);
                state.signalFlushTimer = null;
            }
            flushSignalQueue();
        } else if (!state.signalFlushTimer) {
            state.signalFlushTimer = setTimeout(flushSignalQueue, 50);
        }
    }

    async function flushSignalQueue() {
        state.signalFlushTimer = null;
        if (!state.inCall || state.signalQueue.length === 0) return;

        const batch = state.signalQueue.splice(0, state.signalQueue.length);
        try {
            await apiRequest('signal_batch', {
                room_id: state.callRoomId,
                sender_id: state.peerId,
                signals: batch,
            });
        } catch (err) {}
    }

    function createPeerSession(remotePeerId) {
        const isPolite = state.peerId < remotePeerId;
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        const session = {
            peerId: remotePeerId,
            pc,
            isPolite,
            makingOffer: false,
            ignoreOffer: false,
            isSettingRemoteAnswerPending: false,
            pendingCandidates: [],
            remoteStream: new MediaStream(),
            dataChannel: null,
            audioEl: null,
            analyser: null,
            p2pConnected: false,
        };

        state.peers.set(remotePeerId, session);

        const activeVideoTrack = getActiveVideoTrack();
        const activeAudioTrack = state.localStream ? state.localStream.getAudioTracks()[0] : null;

        if (activeAudioTrack) {
            pc.addTrack(activeAudioTrack, state.localStream);
        }
        if (activeVideoTrack) {
            pc.addTrack(activeVideoTrack, state.screenSharing ? state.screenStream : state.localStream);
        }

        if (!isPolite) {
            const dc = pc.createDataChannel('pulsechat-data', { ordered: true });
            setupDataChannel(session, dc);
        }

        pc.ondatachannel = (event) => {
            setupDataChannel(session, event.channel);
        };

        pc.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                session.remoteStream = event.streams[0];
            } else {
                session.remoteStream.addTrack(event.track);
            }

            // Dedicated audio output element ensures unmuted, high-reliability playback across all browsers
            if (!session.audioEl) {
                const audio = new Audio();
                audio.autoplay = true;
                audio.playsInline = true;
                audio.className = 'remote-audio-sink';
                audio.style.display = 'none';
                const tile = document.getElementById(`tile-${remotePeerId}`);
                const slider = tile ? tile.querySelector('.volume-slider') : null;
                audio.volume = slider ? parseFloat(slider.value) : 1;
                session.audioEl = audio;
                document.body.appendChild(audio);
            }
            if (session.audioEl.srcObject !== session.remoteStream) {
                session.audioEl.srcObject = session.remoteStream;
            }
            session.audioEl.play().catch(() => {});

            attachRemoteStreamToTile(remotePeerId, session.remoteStream);
            setupRemoteAudioAnalyser(session, session.remoteStream);
        };

        pc.onicecandidate = ({ candidate }) => {
            if (candidate) {
                queueSignal(remotePeerId, 'ice-candidate', candidate.toJSON ? candidate.toJSON() : candidate);
            }
        };

        pc.onnegotiationneeded = async () => {
            try {
                session.makingOffer = true;
                await pc.setLocalDescription();
                queueSignal(remotePeerId, 'description', pc.localDescription);
            } catch (err) {
            } finally {
                session.makingOffer = false;
            }
        };

        const checkConnectionStatus = () => {
            const stateStr = pc.connectionState || pc.iceConnectionState;
            session.p2pConnected = (stateStr === 'connected' || stateStr === 'completed');
            if (stateStr === 'failed') {
                try { pc.restartIce(); } catch (e) {}
            }
        };

        pc.onconnectionstatechange = checkConnectionStatus;
        pc.oniceconnectionstatechange = checkConnectionStatus;

        return session;
    }

    async function handleIncomingSignal(sig) {
        const senderId = sig.senderId;
        const type = sig.type;
        const payload = sig.payload;
        if (!senderId || !payload) return;

        let session = state.peers.get(senderId);
        if (!session) {
            session = createPeerSession(senderId);
        }

        const pc = session.pc;
        if (!pc) return;

        try {
            if (type === 'description') {
                const description = payload;
                const readyForOffer =
                    !session.makingOffer &&
                    (pc.signalingState === 'stable' || session.isSettingRemoteAnswerPending);
                const offerCollision = description.type === 'offer' && !readyForOffer;

                session.ignoreOffer = !session.isPolite && offerCollision;
                if (session.ignoreOffer) return;

                session.isSettingRemoteAnswerPending = description.type === 'answer';
                if (offerCollision) {
                    try {
                        await pc.setLocalDescription({ type: 'rollback' });
                    } catch (rbErr) {}
                }
                try {
                    await pc.setRemoteDescription(description);
                } finally {
                    session.isSettingRemoteAnswerPending = false;
                }

                while (session.pendingCandidates.length > 0) {
                    const cand = session.pendingCandidates.shift();
                    try { await pc.addIceCandidate(cand); } catch (cErr) {}
                }

                if (description.type === 'offer') {
                    await pc.setLocalDescription();
                    queueSignal(senderId, 'description', pc.localDescription);
                }
            } else if (type === 'ice-candidate') {
                try {
                    if (pc.remoteDescription && pc.remoteDescription.type) {
                        await pc.addIceCandidate(payload);
                    } else {
                        session.pendingCandidates.push(payload);
                    }
                } catch (err) {
                    if (!session.ignoreOffer) {
                        session.pendingCandidates.push(payload);
                    }
                }
            }
        } catch (err) {}
    }

    function setupDataChannel(session, channel) {
        session.dataChannel = channel;
        channel.onmessage = (event) => {
            try {
                const packet = JSON.parse(event.data);
                if (packet.type === 'chat-msg' && packet.message) {
                    if (packet.message.roomId === state.activeTextRoomId) {
                        const isNew = !state.renderedMessageIds.has(packet.message.id);
                        appendChatMessage(packet.message);
                        scrollToChatBottom();
                        if (isNew && state.user && packet.message.userId !== state.user.userId) {
                            notifyIncomingMessage(packet.message, state.activeTextRoomId, state.activeTextRoomType, state.activeTextRoomTitle);
                        }
                    }
                } else if (packet.type === 'chat-edit' && packet.message) {
                    if (packet.message.roomId === state.activeTextRoomId) {
                        updateRenderedMessage(packet.message);
                    }
                } else if (packet.type === 'media-state') {
                    const p = state.participants.get(session.peerId);
                    if (p) {
                        p.micEnabled = Boolean(packet.micEnabled);
                        p.camEnabled = Boolean(packet.camEnabled);
                        p.screenSharing = Boolean(packet.screenSharing);
                        updateRemoteTileBadges(session.peerId);
                    }
                }
            } catch (e) {}
        };
    }

    function broadcastDataChannelControl(packet) {
        const raw = JSON.stringify(packet);
        state.peers.forEach(session => {
            if (session.dataChannel && session.dataChannel.readyState === 'open') {
                try { session.dataChannel.send(raw); } catch (e) {}
            }
        });
    }

    function closePeerSession(remotePeerId) {
        const session = state.peers.get(remotePeerId);
        if (!session) return;
        try {
            if (session.audioEl) {
                session.audioEl.pause();
                session.audioEl.srcObject = null;
                session.audioEl.remove();
                session.audioEl = null;
            }
            if (session.dataChannel) session.dataChannel.close();
            if (session.pc) session.pc.close();
        } catch (e) {}
        state.peers.delete(remotePeerId);
    }

    function setupRemoteAudioAnalyser(session, stream) {
        if (!stream || stream.getAudioTracks().length === 0) return;
        try {
            if (!state.audioContext) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                state.audioContext = new AudioCtx();
            }
            if (state.audioContext.state === 'suspended') {
                state.audioContext.resume().catch(() => {});
            }
            const source = state.audioContext.createMediaStreamSource(stream);
            const analyser = state.audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.75;
            source.connect(analyser);
            session.analyser = analyser;
        } catch (e) {}
    }

    // ======================= SCREEN SHARING =======================
    async function toggleScreenShare() {
        if (state.screenSharing) {
            await stopScreenShare(true);
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            showToast('Screen sharing is not supported in this browser.', 'warning');
            return;
        }
        try {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always', frameRate: { ideal: 24, max: 30 } },
                audio: false,
            });
            state.screenStream = displayStream;
            state.screenSharing = true;
            displayStream.getVideoTracks()[0].onended = () => stopScreenShare(true);

            syncMediaControlsUI();
            updateLocalTileStream();
            updateLocalTileBadges();
            replaceOutgoingTracks();
            broadcastDataChannelControl({
                type: 'media-state',
                micEnabled: state.micEnabled,
                camEnabled: state.camEnabled,
                screenSharing: state.screenSharing,
            });
        } catch (err) {}
    }

    async function stopScreenShare(notify = true) {
        if (state.screenStream) {
            state.screenStream.getTracks().forEach(t => t.stop());
            state.screenStream = null;
        }
        state.screenSharing = false;
        syncMediaControlsUI();
        if (state.inCall) {
            updateLocalTileStream();
            updateLocalTileBadges();
            replaceOutgoingTracks();
            if (notify) {
                broadcastDataChannelControl({
                    type: 'media-state',
                    micEnabled: state.micEnabled,
                    camEnabled: state.camEnabled,
                    screenSharing: state.screenSharing,
                });
            }
        }
    }

    function getActiveVideoTrack() {
        if (state.screenSharing && state.screenStream && state.screenStream.getVideoTracks().length > 0) {
            return state.screenStream.getVideoTracks()[0];
        }
        if (state.localStream && state.localStream.getVideoTracks().length > 0) {
            return state.localStream.getVideoTracks()[0];
        }
        return null;
    }

    function replaceOutgoingTracks() {
        const videoTrack = getActiveVideoTrack();
        const audioTrack = state.localStream ? state.localStream.getAudioTracks()[0] : null;

        state.peers.forEach(session => {
            if (!session.pc) return;
            const senders = session.pc.getSenders();
            const vSender = senders.find(s => (s.track && s.track.kind === 'video') || (s.track === null && session.pc.getTransceivers().some(t => t.sender === s && t.receiver && t.receiver.track && t.receiver.track.kind === 'video')));
            if (videoTrack) {
                if (vSender) {
                    vSender.replaceTrack(videoTrack).catch(() => {});
                } else {
                    try { session.pc.addTrack(videoTrack, state.screenSharing ? state.screenStream : state.localStream); } catch (e) {}
                }
            } else if (vSender && vSender.track) {
                vSender.replaceTrack(null).catch(() => {});
            }

            const aSender = senders.find(s => s.track && s.track.kind === 'audio');
            if (audioTrack) {
                if (aSender) {
                    aSender.replaceTrack(audioTrack).catch(() => {});
                } else {
                    try { session.pc.addTrack(audioTrack, state.localStream); } catch (e) {}
                }
            }
        });
    }

    // ======================= VIDEO TILES =======================
    function ensureVideoTile(info) {
        let tile = document.getElementById(`tile-${info.peerId}`);
        if (tile) return tile;

        tile = document.createElement('div');
        tile.id = `tile-${info.peerId}`;
        tile.className = `video-tile ${info.isLocal ? 'local-tile' : 'remote-tile'}`;

        tile.innerHTML = `
            <video autoplay playsinline muted></video>
            <div class="tile-avatar-layer">
                ${renderAvatarMarkup(info.username, info.avatarColor, info.avatarUrl, 'large')}
            </div>
            <div class="tile-top-bar">
                <button type="button" class="tile-action-btn pin-btn" title="Spotlight">📌</button>
            </div>
            <div class="tile-bottom-bar">
                <div class="peer-name-pill">
                    <span class="peer-name-text">${escapeHtml(info.username)}${info.isLocal ? ' (You)' : ''}</span>
                    <span class="mute-indicator ${info.micEnabled ? 'hidden' : ''}">🔇</span>
                </div>
                ${!info.isLocal ? `
                <div class="volume-control-wrap" title="Volume">
                    <span>🔊</span>
                    <input type="range" class="volume-slider" min="0" max="1" step="0.05" value="1">
                </div>
                ` : ''}
            </div>
        `;

        tile.querySelector('.pin-btn').addEventListener('click', () => togglePinPeer(info.peerId));

        if (!info.isLocal) {
            const slider = tile.querySelector('.volume-slider');
            slider.addEventListener('input', () => {
                const vol = parseFloat(slider.value);
                const session = state.peers.get(info.peerId);
                if (session && session.audioEl) {
                    session.audioEl.volume = vol;
                }
            });
        }

        dom.videoGrid.appendChild(tile);

        if (info.isLocal) {
            updateLocalTileStream();
            updateLocalTileBadges();
        } else {
            const session = state.peers.get(info.peerId);
            if (session && session.remoteStream) {
                attachRemoteStreamToTile(info.peerId, session.remoteStream);
            }
            updateRemoteTileBadges(info.peerId);
        }

        updateGridCount();
        return tile;
    }

    function updateLocalTileStream() {
        const tile = document.getElementById(`tile-${state.peerId}`);
        if (!tile) return;
        const video = tile.querySelector('video');
        video.srcObject = (state.screenSharing && state.screenStream) ? state.screenStream : state.localStream;
    }

    function updateLocalTileBadges() {
        const tile = document.getElementById(`tile-${state.peerId}`);
        if (!tile) return;
        const hasVideo = state.localStream && state.localStream.getVideoTracks().length > 0;
        const showVideo = (state.camEnabled && hasVideo) || state.screenSharing;
        tile.classList.toggle('screen-sharing', state.screenSharing);
        tile.querySelector('.tile-avatar-layer').classList.toggle('hidden', showVideo);
        tile.querySelector('.mute-indicator').classList.toggle('hidden', state.micEnabled);
    }

    function updateRemoteTileBadges(remotePeerId) {
        const tile = document.getElementById(`tile-${remotePeerId}`);
        const p = state.participants.get(remotePeerId);
        if (!tile || !p) return;

        const session = state.peers.get(remotePeerId);
        const hasRemoteVideo = session && session.remoteStream && session.remoteStream.getVideoTracks().length > 0;
        const showVideo = (p.camEnabled || p.screenSharing) && hasRemoteVideo;

        tile.classList.toggle('screen-sharing', Boolean(p.screenSharing));
        tile.querySelector('.tile-avatar-layer').classList.toggle('hidden', Boolean(showVideo));
        tile.querySelector('.mute-indicator').classList.toggle('hidden', Boolean(p.micEnabled));
        tile.querySelector('.peer-name-text').textContent = p.screenSharing ? `${p.username} (Screen)` : p.username;
    }

    function attachRemoteStreamToTile(remotePeerId, stream) {
        const tile = document.getElementById(`tile-${remotePeerId}`);
        if (!tile) return;
        const video = tile.querySelector('video');
        if (video.srcObject !== stream) {
            video.srcObject = stream;
        }
        video.play().catch(() => {});

        const session = state.peers.get(remotePeerId);
        if (session) {
            if (!session.audioEl) {
                const audio = new Audio();
                audio.autoplay = true;
                audio.playsInline = true;
                audio.className = 'remote-audio-sink';
                audio.style.display = 'none';
                const slider = tile.querySelector('.volume-slider');
                audio.volume = slider ? parseFloat(slider.value) : 1;
                session.audioEl = audio;
                document.body.appendChild(audio);
            }
            if (session.audioEl.srcObject !== stream) {
                session.audioEl.srcObject = stream;
            }
            session.audioEl.play().catch(() => {});
        }

        updateRemoteTileBadges(remotePeerId);
    }

    function removeVideoTile(peerId) {
        const tile = document.getElementById(`tile-${peerId}`);
        if (tile) tile.remove();
        if (state.pinnedPeerId === peerId) {
            state.pinnedPeerId = null;
            dom.unpinAllBtn.classList.add('hidden');
        }
        updateGridCount();
    }

    function togglePinPeer(peerId) {
        state.pinnedPeerId = state.pinnedPeerId === peerId ? null : peerId;
        document.querySelectorAll('.video-tile').forEach(tile => {
            tile.classList.toggle('pinned', tile.id === `tile-${state.pinnedPeerId}`);
        });
        dom.videoGrid.classList.toggle('has-pinned', Boolean(state.pinnedPeerId));
        dom.unpinAllBtn.classList.toggle('hidden', !state.pinnedPeerId);
    }

    function updateGridCount() {
        const total = Math.max(1, Math.min(6, dom.videoGrid.children.length));
        dom.videoGrid.className = `video-grid count-${total}${state.pinnedPeerId ? ' has-pinned' : ''}`;
    }

    // ======================= TEXT CHAT =======================
    function canEditMessage(msg) {
        if (!state.user || !msg) return false;
        if (msg.type === 'image' || msg.type === 'file') return false; // editing is for text messages
        return msg.userId === state.user.userId || state.user.role === 'admin';
    }

    function resetAndRenderMessages(messages) {
        dom.chatMessages.innerHTML = '';
        state.renderedMessageIds.clear();
        state.roomMessages.clear();
        state.lastMessageId = 0;
        cancelEditingMessage();

        const welcome = document.createElement('div');
        welcome.className = 'empty-chat-banner';
        if (state.activeTextRoomType === 'dm' && state.activeDmContact) {
            welcome.innerHTML = `
                <h3>@${escapeHtml(state.activeDmContact.username)}</h3>
                <p>This is the beginning of your direct message history with <strong>${escapeHtml(state.activeDmContact.username)}</strong>.</p>
            `;
        } else {
            welcome.innerHTML = `
                <h3>Welcome to #${escapeHtml(state.activeTextRoomTitle)}!</h3>
                <p>This is the start of the #${escapeHtml(state.activeTextRoomTitle)} channel.</p>
            `;
        }
        dom.chatMessages.appendChild(welcome);

        messages.forEach(msg => appendChatMessage(msg));
        scrollToChatBottom();
    }

    function appendChatMessage(msg) {
        if (!msg || !msg.id) return;
        state.roomMessages.set(msg.id, msg);

        if (state.renderedMessageIds.has(msg.id)) {
            updateRenderedMessage(msg);
            return;
        }
        state.renderedMessageIds.add(msg.id);

        if (msg.id > state.lastMessageId) {
            state.lastMessageId = msg.id;
        }

        const isEditable = canEditMessage(msg);
        const editedBadgeHtml = (msg.editedAt && msg.editedAt > 0)
            ? `<span class="chat-edited-badge" title="Edited ${(new Date(msg.editedAt * 1000)).toLocaleString()}">(edited)</span>`
            : '';

        const row = document.createElement('div');
        row.className = 'chat-row';
        row.dataset.messageId = String(msg.id);
        row.innerHTML = `
            ${renderAvatarMarkup(msg.username, msg.avatarColor, msg.avatarUrl)}
            <div class="chat-row-body">
                <div class="chat-row-header">
                    <span class="chat-author" style="color:${escapeHtml(msg.avatarColor || '#f6efe9')}">${escapeHtml(msg.username)}</span>
                    <span class="chat-timestamp">${formatTime(msg.createdAt)}</span>
                    ${editedBadgeHtml}
                </div>
                <div class="chat-text">${formatMessageBody(msg.content, msg.type)}</div>
            </div>
            ${isEditable ? `
                <div class="chat-row-actions">
                    <button type="button" class="chat-msg-btn edit-msg-btn" title="Edit message (or press Up in message bar)">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 20h9"/>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                        </svg>
                    </button>
                </div>
            ` : ''}
        `;

        const editBtn = row.querySelector('.edit-msg-btn');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                startEditingMessage(msg);
            });
        }

        const imgWrap = row.querySelector('.chat-image-wrap');
        if (imgWrap) {
            imgWrap.addEventListener('click', () => {
                openImageLightbox(msg.content);
            });
        }

        dom.chatMessages.appendChild(row);
    }

    function updateRenderedMessage(msg) {
        if (!msg || !msg.id) return;
        state.roomMessages.set(msg.id, msg);

        const row = dom.chatMessages.querySelector(`.chat-row[data-message-id="${msg.id}"]`);
        if (!row) return;

        const textEl = row.querySelector('.chat-text');
        if (textEl) {
            textEl.innerHTML = formatMessageBody(msg.content, msg.type);
        }

        const headerEl = row.querySelector('.chat-row-header');
        if (headerEl && msg.editedAt && msg.editedAt > 0) {
            let badge = headerEl.querySelector('.chat-edited-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'chat-edited-badge';
                headerEl.appendChild(badge);
            }
            badge.textContent = '(edited)';
            badge.title = `Edited ${(new Date(msg.editedAt * 1000)).toLocaleString()}`;
        }

        if (state.editingMessageId === msg.id) {
            cancelEditingMessage();
        }
    }

    function startEditingMessage(msg) {
        if (!msg || msg.type === 'image' || msg.type === 'file') return;
        state.editingMessageId = msg.id;

        dom.chatMessages.querySelectorAll('.chat-row.is-editing').forEach(el => el.classList.remove('is-editing'));
        const row = dom.chatMessages.querySelector(`.chat-row[data-message-id="${msg.id}"]`);
        if (row) {
            row.classList.add('is-editing');
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        if (dom.chatEditBar) {
            dom.chatEditBar.classList.remove('hidden');
        }
        dom.chatInput.value = msg.content;
        dom.chatInput.focus();
        try {
            dom.chatInput.setSelectionRange(dom.chatInput.value.length, dom.chatInput.value.length);
        } catch (_) {}
    }

    function cancelEditingMessage() {
        state.editingMessageId = null;
        if (dom.chatEditBar) {
            dom.chatEditBar.classList.add('hidden');
        }
        if (dom.chatMessages) {
            dom.chatMessages.querySelectorAll('.chat-row.is-editing').forEach(el => el.classList.remove('is-editing'));
        }
    }

    async function submitEditMessage(msgId, newContent) {
        const clean = parseEmoticonsToEmoji(newContent.trim());
        if (!clean) {
            showToast('Message cannot be empty', 'error');
            return;
        }

        const origMsg = state.roomMessages.get(msgId);
        if (origMsg && origMsg.content === clean) {
            cancelEditingMessage();
            dom.chatInput.value = '';
            return;
        }

        try {
            const res = await apiRequest('edit_message', {
                message_id: msgId,
                content: clean,
            });
            if (res.message) {
                updateRenderedMessage(res.message);
                broadcastDataChannelControl({
                    type: 'chat-edit',
                    message: res.message,
                });
                cancelEditingMessage();
                dom.chatInput.value = '';
            }
        } catch (err) {
            showToast(err.message || 'Failed to edit message', 'error');
        }
    }

    function formatBytes(bytes) {
        if (!bytes || isNaN(bytes)) return '0 B';
        if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return bytes + ' B';
    }

    function showFileTooLargeAlert(fileSize) {
        if (dom.fileTooLargeActual) {
            dom.fileTooLargeActual.textContent = formatBytes(fileSize);
        }
        if (dom.fileTooLargeModal) {
            dom.fileTooLargeModal.classList.remove('hidden');
        }
    }

    function closeFileTooLargeAlert() {
        if (dom.fileTooLargeModal) {
            dom.fileTooLargeModal.classList.add('hidden');
        }
    }

    function openImageLightbox(url) {
        if (!dom.imageLightboxModal || !dom.lightboxImg) return;
        dom.lightboxImg.src = url;
        if (dom.lightboxDownloadLink) {
            dom.lightboxDownloadLink.href = url;
        }
        dom.imageLightboxModal.classList.remove('hidden');
    }

    function closeImageLightbox() {
        if (!dom.imageLightboxModal) return;
        dom.imageLightboxModal.classList.add('hidden');
        if (dom.lightboxImg) dom.lightboxImg.src = '';
    }

    async function uploadSharedFile(file) {
        if (!file) return;

        // Check 128 MB limit before sending to save bandwidth and give instant feedback
        if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
            showFileTooLargeAlert(file.size);
            return;
        }

        if (dom.chatUploadBar) {
            dom.chatUploadBar.classList.remove('hidden');
            if (dom.chatUploadLabel) {
                dom.chatUploadLabel.textContent = `Uploading ${file.name || 'file'} (${formatBytes(file.size)})...`;
            }
        }

        try {
            const formData = new FormData();
            formData.append('auth_token', state.authToken);
            formData.append('room_id', state.activeTextRoomId);
            formData.append('peer_id', state.peerId);
            formData.append('file', file);

            const response = await fetch(`${API_URL}?action=upload_file`, {
                method: 'POST',
                body: formData,
            });

            let res;
            try {
                res = await response.json();
            } catch (parseErr) {
                if (response.status === 413) {
                    showFileTooLargeAlert(file.size);
                    return;
                }
                throw new Error('Server returned invalid response');
            }

            if (response.status === 413 || (res && !res.ok && res.error && res.error.includes('128 MB'))) {
                showFileTooLargeAlert(file.size);
                return;
            }

            if (!res.ok || !res.message) {
                showToast(res.error || 'Failed to upload file', 'error');
                return;
            }

            appendChatMessage(res.message);
            scrollToChatBottom();
            broadcastDataChannelControl({
                type: 'chat-msg',
                message: res.message,
            });
        } catch (err) {
            showToast(err.message || 'File upload failed', 'error');
        } finally {
            if (dom.chatUploadBar) {
                dom.chatUploadBar.classList.add('hidden');
            }
        }
    }
    const uploadChatImage = uploadSharedFile;

    async function openTextFilePreview(url, name) {
        if (!dom.filePreviewModal) return;
        if (dom.filePreviewTitle) dom.filePreviewTitle.textContent = name || 'Text File';
        if (dom.filePreviewContent) dom.filePreviewContent.textContent = 'Loading file contents...';
        if (dom.filePreviewDownload) {
            dom.filePreviewDownload.href = url;
            dom.filePreviewDownload.setAttribute('download', name || 'file.txt');
        }
        dom.filePreviewModal.classList.remove('hidden');

        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('Could not read file');
            const text = await resp.text();
            if (dom.filePreviewContent) {
                dom.filePreviewContent.textContent = text.slice(0, 500000);
            }
        } catch (e) {
            if (dom.filePreviewContent) {
                dom.filePreviewContent.textContent = 'Could not load preview for this file. Click Download below to open.';
            }
        }
    }

    function closeTextFilePreview() {
        if (dom.filePreviewModal) {
            dom.filePreviewModal.classList.add('hidden');
            if (dom.filePreviewContent) dom.filePreviewContent.textContent = '';
        }
    }

    // ======================= URL IMAGE PREVIEWS ON HOVER =======================
    let hoverPreviewTimer = null;
    let currentPreviewLink = null;
    let isMouseOverPopover = false;

    function initUrlPreviewHover() {
        if (!dom.linkPreviewPopover) return;

        dom.linkPreviewPopover.addEventListener('mouseenter', () => {
            isMouseOverPopover = true;
        });

        dom.linkPreviewPopover.addEventListener('mouseleave', () => {
            isMouseOverPopover = false;
            hideLinkPreview();
        });

        document.addEventListener('mouseover', (e) => {
            const link = e.target.closest('.chat-preview-link');
            if (!link) return;
            if (currentPreviewLink === link) return;

            clearTimeout(hoverPreviewTimer);
            hoverPreviewTimer = setTimeout(() => {
                showLinkPreview(link);
            }, 160);
        });

        document.addEventListener('mouseout', (e) => {
            const link = e.target.closest('.chat-preview-link');
            if (!link) return;

            clearTimeout(hoverPreviewTimer);
            setTimeout(() => {
                if (!isMouseOverPopover) {
                    hideLinkPreview();
                }
            }, 90);
        });

        window.addEventListener('scroll', () => hideLinkPreview(), { passive: true });
        if (dom.chatMessages) {
            dom.chatMessages.addEventListener('scroll', () => hideLinkPreview(), { passive: true });
        }
    }

    async function showLinkPreview(linkEl) {
        currentPreviewLink = linkEl;
        const url = linkEl.getAttribute('data-preview-url') || linkEl.href;
        if (!url || !url.startsWith('http')) return;

        const popover = dom.linkPreviewPopover;
        if (!popover) return;

        const rect = linkEl.getBoundingClientRect();
        const popoverWidth = 320;
        const popoverHeight = 270;

        let left = rect.left + (rect.width / 2) - (popoverWidth / 2);
        if (left < 10) left = 10;
        if (left + popoverWidth > window.innerWidth - 10) {
            left = window.innerWidth - popoverWidth - 10;
        }

        let top = rect.top - popoverHeight - 12;
        if (top < 10) {
            top = rect.bottom + 12;
        }

        popover.style.left = `${Math.round(left)}px`;
        popover.style.top = `${Math.round(top)}px`;

        const isDirectImage = /\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i.test(url);
        let domain = '';
        try { domain = new URL(url).hostname; } catch (_) { domain = url; }

        if (dom.linkPreviewDomain) dom.linkPreviewDomain.textContent = domain;
        if (dom.linkPreviewTitle) dom.linkPreviewTitle.textContent = isDirectImage ? url.split('/').pop() : 'Loading preview...';
        if (dom.linkPreviewDesc) dom.linkPreviewDesc.textContent = isDirectImage ? 'Direct image file' : url;
        if (dom.linkPreviewMedia) dom.linkPreviewMedia.classList.add('loading');
        if (dom.linkPreviewImg) {
            dom.linkPreviewImg.style.display = 'none';
            dom.linkPreviewImg.src = '';
        }

        popover.classList.remove('hidden');

        if (isDirectImage) {
            if (dom.linkPreviewImg) {
                dom.linkPreviewImg.src = url;
                dom.linkPreviewImg.onload = () => {
                    dom.linkPreviewImg.style.display = 'block';
                    if (dom.linkPreviewMedia) dom.linkPreviewMedia.classList.remove('loading');
                };
                dom.linkPreviewImg.onerror = () => {
                    if (dom.linkPreviewMedia) dom.linkPreviewMedia.classList.remove('loading');
                };
            }
            return;
        }

        if (state.urlPreviewCache.has(url)) {
            renderPreviewData(state.urlPreviewCache.get(url));
            return;
        }

        try {
            const res = await apiRequest('url_preview', { url });
            if (res && res.ok) {
                state.urlPreviewCache.set(url, res);
                if (currentPreviewLink === linkEl) {
                    renderPreviewData(res);
                }
            } else {
                renderPreviewFallback(url, domain);
            }
        } catch (err) {
            renderPreviewFallback(url, domain);
        }
    }

    function renderPreviewData(data) {
        if (!data) return;
        if (dom.linkPreviewDomain) dom.linkPreviewDomain.textContent = data.domain || '';
        if (dom.linkPreviewTitle) dom.linkPreviewTitle.textContent = data.title || data.domain || 'Link Preview';
        if (dom.linkPreviewDesc) dom.linkPreviewDesc.textContent = data.description || '';

        const imgUrl = data.imageUrl || `https://s.wordpress.com/mshots/v1/${encodeURIComponent(data.url)}?w=600`;
        if (dom.linkPreviewImg) {
            dom.linkPreviewImg.src = imgUrl;
            dom.linkPreviewImg.onload = () => {
                dom.linkPreviewImg.style.display = 'block';
                if (dom.linkPreviewMedia) dom.linkPreviewMedia.classList.remove('loading');
            };
            dom.linkPreviewImg.onerror = () => {
                dom.linkPreviewImg.src = `https://s2.googleusercontent.com/s2/favicons?domain=${encodeURIComponent(data.domain || '')}&sz=128`;
                dom.linkPreviewImg.style.display = 'block';
                if (dom.linkPreviewMedia) dom.linkPreviewMedia.classList.remove('loading');
            };
        }
    }

    function renderPreviewFallback(url, domain) {
        if (dom.linkPreviewDomain) dom.linkPreviewDomain.textContent = domain;
        if (dom.linkPreviewTitle) dom.linkPreviewTitle.textContent = domain;
        if (dom.linkPreviewDesc) dom.linkPreviewDesc.textContent = url;
        if (dom.linkPreviewImg) {
            dom.linkPreviewImg.src = `https://s2.googleusercontent.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
            dom.linkPreviewImg.style.display = 'block';
        }
        if (dom.linkPreviewMedia) dom.linkPreviewMedia.classList.remove('loading');
    }

    function hideLinkPreview() {
        currentPreviewLink = null;
        if (dom.linkPreviewPopover) {
            dom.linkPreviewPopover.classList.add('hidden');
        }
    }

    // ======================= DRAG AND DROP FILE SHARING =======================
    function initChatDragAndDrop() {
        let dragCounter = 0;

        function isFileDrag(e) {
            if (!e.dataTransfer || !e.dataTransfer.types) return false;
            return Array.from(e.dataTransfer.types).includes('Files');
        }

        window.addEventListener('dragenter', (e) => {
            if (!isFileDrag(e)) return;
            dragCounter++;
            e.preventDefault();
            if (dom.chatDropOverlay) {
                dom.chatDropOverlay.classList.remove('hidden');
            }
        });

        window.addEventListener('dragover', (e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        window.addEventListener('dragleave', (e) => {
            if (!isFileDrag(e)) return;
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                if (dom.chatDropOverlay) {
                    dom.chatDropOverlay.classList.add('hidden');
                }
            }
        });

        window.addEventListener('drop', async (e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            dragCounter = 0;
            if (dom.chatDropOverlay) {
                dom.chatDropOverlay.classList.add('hidden');
            }

            const files = Array.from(e.dataTransfer.files || []);
            if (files.length === 0) return;

            for (const file of files) {
                await uploadSharedFile(file);
            }
        });
    }

    async function sendChatMessage(text) {
        const clean = parseEmoticonsToEmoji(text.trim());
        if (!clean) return;

        try {
            const res = await apiRequest('message', {
                room_id: state.activeTextRoomId,
                peer_id: state.peerId,
                content: clean,
            });
            if (res.message) {
                appendChatMessage(res.message);
                scrollToChatBottom();
                broadcastDataChannelControl({
                    type: 'chat-msg',
                    message: res.message,
                });
            }
        } catch (err) {
            if (err.message && err.message.toLowerCase().includes('channel no longer exists')) {
                showToast('This channel was deleted. Switching to default channel.', 'error');
                const fallback = state.channels[0] ? state.channels[0].channelId : 'general';
                await selectChannel(fallback);
                return;
            }
            showToast('Failed to send message', 'error');
        }
    }

    function scrollToChatBottom() {
        dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    }

    // ======================= COMPREHENSIVE EMOJI PICKER =======================
    const EMOJI_CATALOG = [
        {
            id: 'smileys',
            icon: '😀',
            title: 'Smileys & Emotion',
            items: [
                ['😀', 'grinning happy smile'], ['😃', 'smiley happy'], ['😄', 'smile grin'], ['😁', 'beaming grin'],
                ['😆', 'laughing xd'], ['😅', 'sweat smile'], ['🤣', 'rofl lol laugh'], ['😂', 'joy tears laugh lol'],
                ['🙂', 'slightly smiling'], ['🙃', 'upside down'], ['😉', 'wink'], ['😊', 'blush happy'],
                ['😇', 'innocent angel'], ['🥰', 'smiling hearts love'], ['😍', 'heart eyes love'], ['🤩', 'star struck excited'],
                ['😘', 'kiss heart'], ['😗', 'kissing'], ['😚', 'kissing closed eyes'], ['😙', 'kissing smile'],
                ['😋', 'yum delicious'], ['😛', 'tongue'], ['😜', 'wink tongue crazy'], ['🤪', 'zany goofy'],
                ['😝', 'squinting tongue'], ['🤑', 'money rich'], ['🤗', 'hugging'], ['🤭', 'hand over mouth giggle'],
                ['🤫', 'shushing quiet'], ['🤔', 'thinking hmm'], ['🤐', 'zipper mouth secret'], ['🤨', 'raised eyebrow skeptical'],
                ['😐', 'neutral'], ['😑', 'expressionless'], ['😶', 'no mouth'], ['😏', 'smirk'],
                ['😒', 'unamused'], ['🙄', 'eye roll'], ['😬', 'grimacing awkward'], ['😮‍💨', 'exhale relief'],
                ['🤥', 'lying pinocchio'], ['😌', 'relieved calm'], ['😔', 'pensive sad'], ['😪', 'sleepy'],
                ['🤤', 'drooling'], ['😴', 'sleeping zzz'], ['😷', 'mask sick'], ['🤒', 'thermometer ill'],
                ['🤕', 'bandage hurt'], ['🤢', 'nauseated'], ['🤮', 'vomiting'], ['🤧', 'sneezing'],
                ['🥵', 'hot sweat'], ['🥶', 'cold freezing'], ['🥴', 'woozy dizzy'], ['😵', 'dizzy knocked out'],
                ['🤯', 'exploding head mind blown'], ['🤠', 'cowboy hat'], ['🥳', 'partying celebrate'], ['😎', 'sunglasses cool'],
                ['🤓', 'nerd glasses'], ['🧐', 'monocle inspect'], ['😕', 'confused'], ['😟', 'worried'],
                ['🙁', 'slightly frowning'], ['😮', 'open mouth wow'], ['😯', 'hushed surprised'], ['😲', 'astonished shocked'],
                ['😳', 'flushed embarrassed'], ['🥺', 'pleading puppy eyes'], ['😦', 'frowning open'], ['😧', 'anguished'],
                ['😨', 'fearful scared'], ['😰', 'anxious sweat'], ['😥', 'sad relieved'], ['😢', 'cry tear sad'],
                ['😭', 'sob crying loud'], ['😱', 'scream fear'], ['😖', 'confounded'], ['😣', 'persevering'],
                ['😞', 'disappointed'], ['😓', 'downcast sweat'], ['😩', 'weary tired'], ['😫', 'tired exhausted'],
                ['🥱', 'yawning sleepy'], ['😤', 'triumph steam mad'], ['😡', 'rage angry red'], ['😠', 'angry mad'],
                ['🤬', 'cursing swearing'], ['😈', 'smiling imp devil'], ['👿', 'angry imp'], ['💀', 'skull dead'],
                ['☠️', 'skull crossbones'], ['💩', 'poop'], ['🤡', 'clown'], ['👻', 'ghost boo'],
                ['👽', 'alien ufo'], ['👾', 'space invader monster'], ['🤖', 'robot bot']
            ]
        },
        {
            id: 'gestures',
            icon: '👋',
            title: 'Gestures & People',
            items: [
                ['👋', 'wave hello hi bye'], ['🤚', 'raised back hand'], ['🖐️', 'hand splayed'], ['✋', 'raised hand stop'],
                ['🖖', 'vulcan salute spock'], ['👌', 'ok hand perfect'], ['🤌', 'pinched fingers italian'], ['🤏', 'pinching small'],
                ['✌️', 'peace victory'], ['🤞', 'crossed fingers luck'], ['🤟', 'love you gesture'], ['🤘', 'rock on horns'],
                ['🤙', 'call me shaka'], ['👈', 'point left'], ['👉', 'point right'], ['👆', 'point up'],
                ['🖕', 'middle finger'], ['👇', 'point down'], ['☝️', 'index up'], ['👍', 'thumbs up like yes'],
                ['👎', 'thumbs down dislike no'], ['✊', 'raised fist'], ['👊', 'fist bump punch'], ['🤛', 'left fist'],
                ['🤜', 'right fist'], ['👏', 'clap applause bravo'], ['🙌', 'raising hands hooray'], ['👐', 'open hands'],
                ['🤲', 'palms up'], ['🤝', 'handshake deal'], ['🙏', 'pray thanks please'], ['✍️', 'writing hand'],
                ['💅', 'nail polish sassy'], ['🤳', 'selfie'], ['💪', 'muscle strong flex'], ['🧠', 'brain smart'],
                ['👀', 'eyes look'], ['👁️', 'eye'], ['🫦', 'biting lip'], ['🫂', 'people hugging hug'],
                ['🤦', 'facepalm'], ['🤷', 'shrug idk'], ['🙋', 'raising hand'], ['🙇', 'bowing'],
                ['🕺', 'man dancing'], ['💃', 'woman dancing']
            ]
        },
        {
            id: 'hearts',
            icon: '❤️',
            title: 'Hearts & Symbols',
            items: [
                ['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'],
                ['💙', 'blue heart'], ['💜', 'purple heart'], ['🖤', 'black heart'], ['🤍', 'white heart'],
                ['🤎', 'brown heart'], ['💔', 'broken heart'], ['❣️', 'heart exclamation'], ['💕', 'two hearts'],
                ['💞', 'revolving hearts'], ['💓', 'beating heart'], ['💗', 'growing heart'], ['💖', 'sparkling heart'],
                ['💘', 'heart arrow cupid'], ['💝', 'heart ribbon'], ['💟', 'heart decoration'], ['🔥', 'fire lit hot'],
                ['✨', 'sparkles magic stars'], ['🌟', 'glowing star'], ['💫', 'dizzy star shooting'], ['💥', 'boom collision'],
                ['💢', 'anger symbol'], ['💦', 'sweat droplets'], ['💨', 'dash wind fast'], ['💯', '100 hundred perfect'],
                ['✅', 'check mark yes done'], ['❌', 'cross mark no'], ['❓', 'question'], ['❗', 'exclamation'],
                ['💤', 'zzz sleep'], ['🎵', 'musical note'], ['🎶', 'music notes'], ['🔔', 'bell notification']
            ]
        },
        {
            id: 'space',
            icon: '🌌',
            title: 'Space, Nature & Animals',
            items: [
                ['🌌', 'milky way galaxy space'], ['🪐', 'ringed planet saturn'], ['🌍', 'earth globe'], ['🌙', 'crescent moon'],
                ['🌕', 'full moon'], ['☀️', 'sun sunny'], ['⭐', 'star'], ['🌠', 'shooting star'],
                ['☄️', 'comet'], ['🚀', 'rocket launch space'], ['🛸', 'flying saucer ufo'], ['🛰️', 'satellite'],
                ['🔭', 'telescope stargazer'], ['🌈', 'rainbow'], ['⚡', 'lightning zap'], ['❄️', 'snowflake cold'],
                ['🌊', 'ocean wave'], ['🍀', 'four leaf clover luck'], ['🌹', 'rose flower'], ['🌻', 'sunflower'],
                ['🌴', 'palm tree'], ['🌵', 'cactus'], ['🐶', 'dog puppy'], ['🐱', 'cat kitty'],
                ['🐭', 'mouse'], ['🐹', 'hamster'], ['🐰', 'rabbit bunny'], ['🦊', 'fox'],
                ['🐻', 'bear'], ['🐼', 'panda'], ['🐨', 'koala'], ['🐯', 'tiger'],
                ['🦁', 'lion'], ['🐮', 'cow'], ['🐷', 'pig'], ['🐸', 'frog'],
                ['🐵', 'monkey'], ['🙈', 'see no evil'], ['🙉', 'hear no evil'], ['🙊', 'speak no evil'],
                ['🐧', 'penguin'], ['🐦', 'bird'], ['🦅', 'eagle'], ['🦉', 'owl'],
                ['🦇', 'bat'], ['🐺', 'wolf'], ['🦄', 'unicorn'], ['🐝', 'bee'],
                ['🦋', 'butterfly'], ['🐢', 'turtle'], ['🐙', 'octopus'], ['🐬', 'dolphin'],
                ['🐳', 'whale'], ['🦈', 'shark'], ['🐉', 'dragon']
            ]
        },
        {
            id: 'food',
            icon: '🍕',
            title: 'Food & Drink',
            items: [
                ['☕', 'coffee hot tea'], ['🍵', 'green tea'], ['🧋', 'bubble tea boba'], ['🍺', 'beer mug'],
                ['🍻', 'clinking beers cheers'], ['🍷', 'wine glass'], ['🥂', 'champagne toast'], ['🥃', 'whiskey tumbler'],
                ['🍸', 'cocktail'], ['🍹', 'tropical drink'], ['🍕', 'pizza'], ['🍔', 'burger hamburger'],
                ['🍟', 'fries'], ['🌭', 'hot dog'], ['🌮', 'taco'], ['🌯', 'burrito'],
                ['🍣', 'sushi'], ['🍜', 'ramen noodles'], ['🍝', 'spaghetti pasta'], ['🥩', 'steak meat'],
                ['🍗', 'poultry chicken'], ['🥗', 'salad'], ['🍿', 'popcorn movie'], ['🍩', 'donut'],
                ['🍪', 'cookie'], ['🎂', 'birthday cake'], ['🍰', 'shortcake'], ['🧁', 'cupcake'],
                ['🍫', 'chocolate'], ['🍬', 'candy'], ['🍦', 'ice cream'], ['🍎', 'apple'],
                ['🍓', 'strawberry'], ['🍒', 'cherries'], ['🍑', 'peach'], ['🍌', 'banana'],
                ['🍉', 'watermelon'], ['🍇', 'grapes'], ['🥑', 'avocado'], ['🌶️', 'hot pepper']
            ]
        },
        {
            id: 'activities',
            icon: '🎉',
            title: 'Activities & Objects',
            items: [
                ['🎉', 'party popper celebrate'], ['🎊', 'confetti ball'], ['🎈', 'balloon'], ['🎁', 'gift present'],
                ['🏆', 'trophy winner'], ['🥇', 'first place gold medal'], ['⚽', 'soccer football'], ['🏀', 'basketball'],
                ['🎮', 'video game controller'], ['🕹️', 'joystick'], ['🎲', 'game die'], ['🎯', 'bullseye direct hit'],
                ['🎸', 'guitar'], ['🎹', 'piano'], ['🎧', 'headphones music'], ['🎤', 'microphone'],
                ['🎬', 'clapper board movie'], ['🎨', 'artist palette'], ['💻', 'laptop computer'], ['📱', 'mobile phone'],
                ['📷', 'camera photo'], ['💡', 'light bulb idea'], ['🔑', 'key'], ['🔒', 'locked'],
                ['💎', 'gem diamond'], ['💰', 'money bag'], ['💸', 'money wings'], ['⏰', 'alarm clock'],
                ['✈️', 'airplane travel'], ['🚗', 'car'], ['🏠', 'house home']
            ]
        }
    ];

    let activeEmojiCategory = 'all';

    function initEmojiPicker() {
        // Render category tabs
        const allTab = `<button type="button" class="emoji-cat-btn active" data-cat="all" title="All Emojis">🌟</button>`;
        const catTabs = EMOJI_CATALOG.map(cat => `
            <button type="button" class="emoji-cat-btn" data-cat="${escapeHtml(cat.id)}" title="${escapeHtml(cat.title)}">${cat.icon}</button>
        `).join('');
        dom.emojiCategoryTabs.innerHTML = allTab + catTabs;

        dom.emojiCategoryTabs.querySelectorAll('.emoji-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeEmojiCategory = btn.getAttribute('data-cat');
                dom.emojiCategoryTabs.querySelectorAll('.emoji-cat-btn').forEach(b => b.classList.toggle('active', b === btn));
                renderEmojiGrid(dom.emojiSearchInput.value);
            });
        });

        dom.emojiSearchInput.addEventListener('input', () => {
            renderEmojiGrid(dom.emojiSearchInput.value);
        });

        renderEmojiGrid('');
    }

    function renderEmojiGrid(searchQuery = '') {
        const q = searchQuery.trim().toLowerCase();
        const sectionsHtml = [];

        EMOJI_CATALOG.forEach(cat => {
            if (activeEmojiCategory !== 'all' && cat.id !== activeEmojiCategory) return;

            const filtered = cat.items.filter(([char, keywords]) => {
                if (!q) return true;
                return keywords.includes(q) || char.includes(q) || cat.title.toLowerCase().includes(q);
            });

            if (filtered.length === 0) return;

            sectionsHtml.push(`
                <div class="emoji-section">
                    <div class="emoji-section-title">${escapeHtml(cat.title)}</div>
                    <div class="emoji-section-items">
                        ${filtered.map(([char, keywords]) => `
                            <button type="button" class="emoji-item-btn" data-emoji="${escapeHtml(char)}" title="${escapeHtml(keywords.split(' ')[0])}">${char}</button>
                        `).join('')}
                    </div>
                </div>
            `);
        });

        dom.emojiGrid.innerHTML = sectionsHtml.length > 0
            ? sectionsHtml.join('')
            : '<div class="field-hint" style="text-align:center;padding:24px 0;">No matching emojis found.</div>';

        dom.emojiGrid.querySelectorAll('.emoji-item-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                insertEmojiIntoChat(btn.getAttribute('data-emoji'));
            });
        });
    }

    function insertEmojiIntoChat(emoji) {
        const input = dom.chatInput;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
        const newPos = start + emoji.length;
        input.focus();
        try {
            input.setSelectionRange(newPos, newPos);
        } catch (e) {}
    }

    // ======================= WORKSPACE UI BINDINGS =======================
    function bindWorkspaceEvents() {
        initEmojiPicker();

        // Emoji Picker Popover toggle & outside click close
        dom.emojiToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = dom.emojiPickerPopover.classList.toggle('hidden');
            dom.emojiToggleBtn.classList.toggle('active', !isHidden);
            if (!isHidden) {
                dom.emojiSearchInput.focus();
            }
        });

        document.addEventListener('click', (e) => {
            if (!dom.emojiPickerPopover.classList.contains('hidden')) {
                if (!dom.emojiPickerPopover.contains(e.target) && e.target !== dom.emojiToggleBtn && !dom.emojiToggleBtn.contains(e.target)) {
                    dom.emojiPickerPopover.classList.add('hidden');
                    dom.emojiToggleBtn.classList.remove('active');
                }
            }
        });

        // Channel creation toggle & form
        dom.toggleNewChannelBtn.addEventListener('click', () => {
            dom.createChannelForm.classList.toggle('hidden');
            if (!dom.createChannelForm.classList.contains('hidden')) {
                dom.newChannelInput.focus();
            }
        });

        dom.createChannelForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await createNewChannel(dom.newChannelInput.value);
        });

        // Add Friend toggle & form
        dom.toggleAddContactBtn.addEventListener('click', () => {
            dom.addContactForm.classList.toggle('hidden');
            if (!dom.addContactForm.classList.contains('hidden')) {
                dom.addContactInput.focus();
            }
        });

        dom.addContactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await addContact(dom.addContactInput.value);
        });

        // Mobile Navigation Drawers
        const isMobileScreen = () => window.innerWidth <= 768;

        if (dom.mobileSidebarToggle) dom.mobileSidebarToggle.addEventListener('click', openMobileSidebar);
        if (dom.mobileSidebarClose) dom.mobileSidebarClose.addEventListener('click', closeMobileSidebar);
        if (dom.mobileSidebarBackdrop) dom.mobileSidebarBackdrop.addEventListener('click', closeMobileSidebar);

        if (dom.mobileMembersClose) dom.mobileMembersClose.addEventListener('click', closeMobileMembers);
        if (dom.mobileMembersBackdrop) dom.mobileMembersBackdrop.addEventListener('click', closeMobileMembers);

        // Toggle right-hand Member List in group channels
        dom.toggleMembersBtn.addEventListener('click', () => {
            if (isMobileScreen()) {
                if (dom.membersSidebar.classList.contains('open')) {
                    closeMobileMembers();
                } else {
                    openMobileMembers();
                }
            } else {
                state.membersSidebarVisible = !state.membersSidebarVisible;
                renderMembersList();
            }
        });

        // Header Call buttons
        dom.headerVoiceBtn.addEventListener('click', async () => {
            if (state.activeTextRoomType === 'dm' && state.activeDmContact) {
                await callContact(state.activeDmContact, false);
            } else {
                await startOrJoinCall(state.activeTextRoomId, `#${state.activeTextRoomTitle}`, false);
            }
        });

        dom.headerVideoBtn.addEventListener('click', async () => {
            if (state.activeTextRoomType === 'dm' && state.activeDmContact) {
                await callContact(state.activeDmContact, true);
            } else {
                await startOrJoinCall(state.activeTextRoomId, `#${state.activeTextRoomTitle}`, true);
            }
        });

        dom.headerLeaveBtn.addEventListener('click', () => leaveCall());
        dom.sidebarLeaveCallBtn.addEventListener('click', () => leaveCall());
        dom.stageLeaveBtn.addEventListener('click', () => leaveCall());

        // Quick Mic / Cam / Screen controls
        dom.quickMicBtn.addEventListener('click', () => toggleMic());
        dom.stageMicBtn.addEventListener('click', () => toggleMic());

        dom.quickCamBtn.addEventListener('click', () => toggleCam());
        dom.stageCamBtn.addEventListener('click', () => toggleCam());
        dom.callBarCamBtn.addEventListener('click', () => toggleCam());

        dom.stageScreenBtn.addEventListener('click', () => toggleScreenShare());
        dom.callBarScreenBtn.addEventListener('click', () => toggleScreenShare());

        dom.unpinAllBtn.addEventListener('click', () => {
            if (state.pinnedPeerId) togglePinPeer(state.pinnedPeerId);
        });

        // Settings Modal (Gear Icon)
        const openSettings = () => {
            state.settingsOpen = true;
            dom.settingsModal.classList.remove('hidden');
            if (state.localStream) {
                dom.settingsVideoPreview.srcObject = state.localStream;
            }
            syncMediaControlsUI();
            updateNotificationSettingsUI();
        };

        const closeSettings = () => {
            state.settingsOpen = false;
            dom.settingsModal.classList.add('hidden');
            // If user tested camera/mic in Settings while not in a call, release hardware on close
            if (!state.inCall && state.localStream) {
                stopLocalMediaTracks();
            }
        };

        dom.openSettingsBtn.addEventListener('click', openSettings);
        dom.closeSettingsBtn.addEventListener('click', closeSettings);
        dom.doneSettingsBtn.addEventListener('click', closeSettings);
        dom.settingsModal.addEventListener('click', (e) => {
            if (e.target === dom.settingsModal) closeSettings();
        });

        dom.testMediaBtn.addEventListener('click', async () => {
            state.camEnabled = true;
            state.micEnabled = true;
            await acquireLocalMedia(true);
        });

        dom.settingsAudioSource.addEventListener('change', () => {
            if (state.inCall || state.localStream) acquireLocalMedia(state.camEnabled);
        });
        dom.settingsVideoSource.addEventListener('change', () => {
            if (state.inCall || state.localStream) acquireLocalMedia(true);
        });

        // Notifications Settings Event Handlers
        dom.notifRequestBtn.addEventListener('click', async () => {
            await requestNotificationPermission();
        });

        dom.notifTestBtn.addEventListener('click', async () => {
            let perm = getNotificationPermission();
            if (perm !== 'granted') {
                perm = await requestNotificationPermission();
                if (perm !== 'granted') return;
            }
            dispatchSystemNotification({
                title: 'Stargazer Chat · Test Notification',
                body: 'Desktop notifications are working! You will be alerted for calls and messages.',
                tag: 'test-notification',
                force: true,
            });
            showToast('Test notification sent to your system!', 'success');
        });

        dom.notifToggleDm.addEventListener('change', (e) => {
            state.notifications.directMessages = e.target.checked;
            saveNotificationSettings();
            if (e.target.checked && getNotificationPermission() === 'default') {
                requestNotificationPermission();
            }
        });

        dom.notifSelectChannel.addEventListener('change', (e) => {
            state.notifications.channelMessages = e.target.value;
            saveNotificationSettings();
            if (e.target.value !== 'none' && getNotificationPermission() === 'default') {
                requestNotificationPermission();
            }
        });

        dom.notifToggleCalls.addEventListener('change', (e) => {
            state.notifications.calls = e.target.checked;
            saveNotificationSettings();
            if (e.target.checked && getNotificationPermission() === 'default') {
                requestNotificationPermission();
            }
        });

        dom.notifToggleSound.addEventListener('change', (e) => {
            state.notifications.sound = e.target.checked;
            saveNotificationSettings();
        });

        dom.notifToggleBgonly.addEventListener('change', (e) => {
            state.notifications.onlyInBackground = e.target.checked;
            saveNotificationSettings();
        });

        // Profile Avatar Upload & Generic Reset in Settings
        dom.settingsAvatarInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            try {
                const dataUrl = await resizeImageFileToDataUrl(file, 160);
                const res = await apiRequest('update_profile', { avatar_url: dataUrl });
                state.user = res.user;
                renderCurrentUserBar();
                showToast('Avatar updated!', 'success');
            } catch (err) {
                showToast(err.message, 'error');
            }
        });

        dom.settingsRemoveAvatarBtn.addEventListener('click', async () => {
            try {
                const res = await apiRequest('update_profile', { avatar_url: '' });
                state.user = res.user;
                renderCurrentUserBar();
                showToast('Switched to generic avatar.', 'info');
            } catch (err) {
                showToast(err.message, 'error');
            }
        });

        dom.logoutBtn.addEventListener('click', async () => {
            if (state.inCall) await leaveCall();
            try {
                await apiRequest('logout', {
                    peer_id: state.peerId,
                    all_devices: false,
                });
            } catch (e) {}
            handleUnauthenticated('You have been signed out.');
        });

        if (dom.logoutAllBtn) {
            dom.logoutAllBtn.addEventListener('click', async () => {
                if (!confirm('Are you sure you want to sign out from all devices?')) return;
                if (state.inCall) await leaveCall();
                try {
                    await apiRequest('logout', {
                        peer_id: state.peerId,
                        all_devices: true,
                    });
                } catch (e) {}
                handleUnauthenticated('You have been signed out from all devices.');
            });
        }

        // Incoming Call Invite Actions
        if (dom.inviteAcceptVideo) {
            dom.inviteAcceptVideo.addEventListener('click', async () => {
                await acceptIncomingCall(true);
            });
        }

        if (dom.inviteAcceptVoice) {
            dom.inviteAcceptVoice.addEventListener('click', async () => {
                await acceptIncomingCall(false);
            });
        }

        if (dom.inviteDecline) {
            dom.inviteDecline.addEventListener('click', async () => {
                await declineIncomingCall();
            });
        }

        if (dom.cancelOutgoingCallBtn) {
            dom.cancelOutgoingCallBtn.addEventListener('click', async () => {
                await cancelOutgoingCall();
            });
        }

        // Status Dropdown Menu
        if (dom.userStatusTrigger && dom.userStatusMenu) {
            dom.userStatusTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                dom.userStatusMenu.classList.toggle('hidden');
            });

            dom.userStatusMenu.querySelectorAll('[data-status-opt]').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const status = btn.getAttribute('data-status-opt');
                    await setUserStatus(status);
                    dom.userStatusMenu.classList.add('hidden');
                });
            });

            document.addEventListener('click', (e) => {
                if (!dom.userStatusMenu.contains(e.target) && !dom.userStatusTrigger.contains(e.target)) {
                    dom.userStatusMenu.classList.add('hidden');
                }
            });
        }

        initInactivityTracker();
        setupMentionAutocomplete();

        // Chat Composer & Editing
        dom.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp') {
                // When input is empty and not currently editing, edit the user's last message
                if (!state.editingMessageId && dom.chatInput.selectionStart === 0 && dom.chatInput.value === '') {
                    const userMsgs = Array.from(state.roomMessages.values())
                        .filter(m => m.userId === state.user?.userId && m.roomId === state.activeTextRoomId && (m.type === 'text' || !m.type));
                    if (userMsgs.length > 0) {
                        e.preventDefault();
                        const lastMsg = userMsgs[userMsgs.length - 1];
                        startEditingMessage(lastMsg);
                    }
                }
            } else if (e.key === 'Escape') {
                if (state.editingMessageId) {
                    e.preventDefault();
                    cancelEditingMessage();
                    dom.chatInput.value = '';
                }
            }
        });

        dom.chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const val = dom.chatInput.value;
            dom.emojiPickerPopover.classList.add('hidden');
            dom.emojiToggleBtn.classList.remove('active');

            if (state.editingMessageId) {
                await submitEditMessage(state.editingMessageId, val);
            } else {
                dom.chatInput.value = '';
                await sendChatMessage(val);
            }
        });

        if (dom.chatEditCancelBtn) {
            dom.chatEditCancelBtn.addEventListener('click', () => {
                cancelEditingMessage();
                dom.chatInput.value = '';
                dom.chatInput.focus();
            });
        }

        // File Attachment & Drag-and-Drop & Paste
        if (dom.chatAttachBtn && dom.chatFileInput) {
            dom.chatAttachBtn.addEventListener('click', () => {
                dom.chatFileInput.click();
            });

            dom.chatFileInput.addEventListener('change', async () => {
                const files = Array.from(dom.chatFileInput.files || []);
                dom.chatFileInput.value = '';
                for (const file of files) {
                    await uploadSharedFile(file);
                }
            });
        }

        dom.chatInput.addEventListener('paste', async (e) => {
            const clipboardData = e.clipboardData || window.clipboardData;
            if (!clipboardData || !clipboardData.items) return;

            for (let i = 0; i < clipboardData.items.length; i++) {
                const item = clipboardData.items[i];
                if (item.kind === 'file') {
                    const blob = item.getAsFile();
                    if (blob) {
                        e.preventDefault();
                        await uploadSharedFile(blob);
                        return;
                    }
                }
            }
        });

        // Initialize drag & drop files onto chat window
        initChatDragAndDrop();

        // Initialize URL link image hover preview
        initUrlPreviewHover();

        // File Preview Modal (for reading text/code files)
        if (dom.closeFilePreviewBtn) dom.closeFilePreviewBtn.addEventListener('click', closeTextFilePreview);
        if (dom.doneFilePreviewBtn) dom.doneFilePreviewBtn.addEventListener('click', closeTextFilePreview);
        if (dom.filePreviewModal) {
            dom.filePreviewModal.addEventListener('click', (e) => {
                if (e.target === dom.filePreviewModal) closeTextFilePreview();
            });
        }
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-file-preview');
            if (!btn) return;
            e.preventDefault();
            const fileUrl = btn.getAttribute('data-preview-file');
            const fileName = btn.getAttribute('data-preview-name');
            openTextFilePreview(fileUrl, fileName);
        });

        // File Too Large Alert Modal
        if (dom.closeFileAlertBtn) dom.closeFileAlertBtn.addEventListener('click', closeFileTooLargeAlert);
        if (dom.doneFileAlertBtn) dom.doneFileAlertBtn.addEventListener('click', closeFileTooLargeAlert);
        if (dom.fileTooLargeModal) {
            dom.fileTooLargeModal.addEventListener('click', (e) => {
                if (e.target === dom.fileTooLargeModal) closeFileTooLargeAlert();
            });
        }

        // Image Lightbox Modal
        if (dom.closeLightboxBtn) dom.closeLightboxBtn.addEventListener('click', closeImageLightbox);
        if (dom.imageLightboxModal) {
            dom.imageLightboxModal.addEventListener('click', (e) => {
                if (e.target === dom.imageLightboxModal) closeImageLightbox();
            });
        }

        // Keyboard shortcuts (M for Mic, V for Video when in a call and not typing)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (dom.adminConfirmModal && !dom.adminConfirmModal.classList.contains('hidden')) {
                    closeAdminConfirmModal();
                    return;
                }
                if (dom.imageLightboxModal && !dom.imageLightboxModal.classList.contains('hidden')) {
                    closeImageLightbox();
                    return;
                }
                if (dom.fileTooLargeModal && !dom.fileTooLargeModal.classList.contains('hidden')) {
                    closeFileTooLargeAlert();
                    return;
                }
            }

            if (!state.user || !state.inCall) return;
            const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

            if (e.key === 'm' || e.key === 'M') {
                e.preventDefault();
                toggleMic();
            } else if (e.key === 'v' || e.key === 'V') {
                e.preventDefault();
                toggleCam();
            }
        });

        window.addEventListener('pagehide', () => {
            if (state.inCall && navigator.sendBeacon && state.authToken) {
                const payload = JSON.stringify({
                    action: 'leave_call',
                    auth_token: state.authToken,
                    room_id: state.callRoomId,
                    peer_id: state.peerId,
                });
                navigator.sendBeacon(`${API_URL}?action=leave_call`, payload);
            }
        });
    }

    // ======================= ADMIN CONTROL CENTER =======================
    const adminState = {
        currentTab: 'members', // 'members' | 'chats' | 'uploads'
        users: [],
        chats: [],
        uploads: [],
        filter: 'all',
        search: '',
        targetUser: null,
        confirmCallback: null,
    };

    function showAdminConfirm({ title, message, subtext = '', confirmBtnText = 'Confirm', isDanger = true, onConfirm }) {
        if (!dom.adminConfirmModal) {
            if (confirm(message)) {
                if (typeof onConfirm === 'function') onConfirm();
            }
            return;
        }

        if (dom.adminConfirmTitle) dom.adminConfirmTitle.textContent = title || 'Confirm Action';
        if (dom.adminConfirmMessage) dom.adminConfirmMessage.textContent = message || 'Are you sure?';
        if (dom.adminConfirmSubtext) {
            dom.adminConfirmSubtext.textContent = subtext || '';
            dom.adminConfirmSubtext.style.display = subtext ? 'block' : 'none';
        }
        if (dom.proceedConfirmModalBtn) {
            dom.proceedConfirmModalBtn.textContent = confirmBtnText;
            dom.proceedConfirmModalBtn.className = isDanger ? 'btn-danger small' : 'btn-primary small';
        }

        adminState.confirmCallback = onConfirm;
        dom.adminConfirmModal.classList.remove('hidden');
    }

    function closeAdminConfirmModal() {
        if (dom.adminConfirmModal) {
            dom.adminConfirmModal.classList.add('hidden');
        }
        adminState.confirmCallback = null;
    }

    function switchAdminTab(tabName) {
        adminState.currentTab = tabName;
        document.querySelectorAll('.admin-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.adminTab === tabName);
        });

        if (dom.adminPaneMembers) dom.adminPaneMembers.classList.toggle('hidden', tabName !== 'members');
        if (dom.adminPaneChats) dom.adminPaneChats.classList.toggle('hidden', tabName !== 'chats');
        if (dom.adminPaneUploads) dom.adminPaneUploads.classList.toggle('hidden', tabName !== 'uploads');

        if (tabName === 'members') {
            fetchAndRenderAdminUsers();
        } else if (tabName === 'chats') {
            fetchAndRenderAdminChats();
        } else if (tabName === 'uploads') {
            fetchAndRenderAdminUploads();
        }
    }

    function openAdminModal() {
        if (state.settingsOpen) {
            dom.settingsModal.classList.add('hidden');
            state.settingsOpen = false;
        }
        closeMobileSidebar();
        closeMobileMembers();
        dom.adminModal.classList.remove('hidden');
        switchAdminTab(adminState.currentTab || 'members');
    }

    function closeAdminModal() {
        dom.adminModal.classList.add('hidden');
        closeAdminSubModals();
        closeAdminConfirmModal();
    }

    function closeAdminSubModals() {
        adminState.targetUser = null;
        if (dom.adminRenameModal) dom.adminRenameModal.classList.add('hidden');
        if (dom.adminBanModal) dom.adminBanModal.classList.add('hidden');
        if (dom.adminDeleteModal) dom.adminDeleteModal.classList.add('hidden');
    }

    async function fetchAndRenderAdminUsers() {
        try {
            const res = await apiRequest('admin_list_users');
            if (res.users) {
                adminState.users = res.users;
                renderAdminUserList();
            }
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    function renderAdminUserList() {
        const search = adminState.search.toLowerCase().trim();
        const filter = adminState.filter;

        const allCount = adminState.users.length;
        const activeCount = adminState.users.filter(u => !u.isBanned).length;
        const bannedCount = adminState.users.filter(u => u.isBanned).length;
        const adminsCount = adminState.users.filter(u => u.isAdmin).length;

        if (dom.adminCountAll) dom.adminCountAll.textContent = allCount;
        if (dom.adminCountActive) dom.adminCountActive.textContent = activeCount;
        if (dom.adminCountBanned) dom.adminCountBanned.textContent = bannedCount;
        if (dom.adminCountAdmins) dom.adminCountAdmins.textContent = adminsCount;
        if (dom.adminTotalLabel) dom.adminTotalLabel.textContent = `Total Users: ${allCount}`;

        const filtered = adminState.users.filter(u => {
            if (filter === 'active' && u.isBanned) return false;
            if (filter === 'banned' && !u.isBanned) return false;
            if (filter === 'admins' && !u.isAdmin) return false;

            if (search) {
                const matchesName = u.username.toLowerCase().includes(search);
                const matchesEmail = (u.email || '').toLowerCase().includes(search);
                const matchesId = u.userId.toLowerCase().includes(search);
                if (!matchesName && !matchesEmail && !matchesId) return false;
            }
            return true;
        });

        dom.adminEmptyMsg.classList.toggle('hidden', filtered.length > 0);
        dom.adminUserList.innerHTML = '';

        filtered.forEach(u => {
            const isSelf = (state.user && state.user.userId === u.userId);
            const card = document.createElement('div');
            card.className = `admin-user-card ${u.isBanned ? 'is-banned' : ''}`;

            const avatarHtml = renderAvatarMarkup(u.username, u.avatarColor, u.avatarUrl);
            const lastSeenText = u.isOnline ? 'Online now' : (u.lastSeen ? `Last seen ${formatTimestamp(u.lastSeen)}` : 'Never');

            card.innerHTML = `
                <div class="admin-user-info">
                    <div class="avatar-wrap">
                        ${avatarHtml}
                        <span class="status-dot ${u.isOnline ? 'online' : 'offline'}"></span>
                    </div>
                    <div class="admin-user-meta">
                        <div class="admin-user-title-row">
                            <span class="admin-username" title="${escapeHtml(u.username)}">${escapeHtml(u.username)}</span>
                            ${u.isAdmin ? '<span class="badge-admin">Admin</span>' : ''}
                            ${u.isBanned ? '<span class="badge-banned">Banned</span>' : ''}
                            ${isSelf ? '<span class="badge-subtle">(You)</span>' : ''}
                        </div>
                        <div class="admin-email-row">
                            <span>${escapeHtml(u.email)}</span>
                            <span>•</span>
                            <span>${lastSeenText}</span>
                            ${u.sessionCount > 0 ? `<span>• ${u.sessionCount} active session${u.sessionCount > 1 ? 's' : ''}</span>` : ''}
                            ${u.isBanned && u.banReason ? `<span class="admin-reason-badge">Reason: ${escapeHtml(u.banReason)}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="admin-user-actions">
                    ${u.isAdmin
                        ? `<button type="button" class="btn-ghost tiny demote-admin-btn ${isSelf ? 'disabled' : ''}" ${isSelf ? 'disabled' : ''} title="${isSelf ? 'Cannot demote yourself' : 'Demote from Administrator to Regular Member'}">Demote Admin</button>`
                        : `<button type="button" class="btn-secondary tiny make-admin-btn btn-admin-promote" title="Grant Administrator Privileges">Make Admin</button>`
                    }
                    <button type="button" class="btn-secondary tiny rename-btn" title="Rename Member">Rename</button>
                    ${u.isBanned
                        ? `<button type="button" class="btn-success tiny unban-btn" title="Lift Ban">Unban</button>`
                        : `<button type="button" class="btn-ghost tiny ban-btn ${isSelf ? 'disabled' : ''}" ${isSelf ? 'disabled' : ''} title="${isSelf ? 'Cannot ban yourself' : 'Ban Member'}">Ban</button>`
                    }
                    <button type="button" class="btn-danger tiny delete-btn ${isSelf ? 'disabled' : ''}" ${isSelf ? 'disabled' : ''} title="${isSelf ? 'Cannot delete yourself' : 'Delete Member'}">Delete</button>
                </div>
            `;

            // Toggle admin role (promote / demote) with confirmation
            const roleBtn = card.querySelector('.demote-admin-btn') || card.querySelector('.make-admin-btn');
            if (roleBtn && !isSelf) {
                roleBtn.addEventListener('click', () => {
                    const willBeAdmin = !u.isAdmin;
                    const actionVerb = willBeAdmin ? 'Promote' : 'Demote';
                    const targetRole = willBeAdmin ? 'Administrator' : 'Regular Member';

                    showAdminConfirm({
                        title: `${actionVerb} "${u.username}"`,
                        message: willBeAdmin
                            ? `Are you sure you want to promote "${u.username}" to an Administrator?`
                            : `Are you sure you want to demote "${u.username}" from Administrator to Member?`,
                        subtext: willBeAdmin
                            ? 'They will have full access to community settings, member management, and storage controls.'
                            : 'They will immediately lose access to all administrative privileges.',
                        confirmBtnText: `${actionVerb} Member`,
                        isDanger: !willBeAdmin,
                        onConfirm: async () => {
                            try {
                                await apiRequest('admin_toggle_role', {
                                    target_user_id: u.userId,
                                    is_admin: willBeAdmin,
                                });
                                showToast(`Updated "${u.username}" to ${targetRole}.`, 'success');
                                await fetchAndRenderAdminUsers();
                            } catch (err) {
                                showToast(err.message, 'error');
                            }
                        }
                    });
                });
            }

            // Wire rename
            card.querySelector('.rename-btn').addEventListener('click', () => {
                adminState.targetUser = u;
                dom.adminRenameTargetDisplay.textContent = u.username;
                dom.adminRenameInput.value = u.username;
                dom.adminRenameModal.classList.remove('hidden');
                dom.adminRenameInput.focus();
                dom.adminRenameInput.select();
            });

            // Wire ban
            const banBtn = card.querySelector('.ban-btn');
            if (banBtn && !isSelf) {
                banBtn.addEventListener('click', () => {
                    adminState.targetUser = u;
                    dom.adminBanTargetDisplay.textContent = u.username;
                    dom.adminBanReasonInput.value = '';
                    dom.adminBanModal.classList.remove('hidden');
                    dom.adminBanReasonInput.focus();
                });
            }

            // Wire unban
            const unbanBtn = card.querySelector('.unban-btn');
            if (unbanBtn) {
                unbanBtn.addEventListener('click', () => {
                    showAdminConfirm({
                        title: `Unban "${u.username}"`,
                        message: `Are you sure you want to lift the ban for "${u.username}"?`,
                        subtext: 'They will be allowed to sign in and participate again.',
                        confirmBtnText: 'Unban Member',
                        isDanger: false,
                        onConfirm: async () => {
                            try {
                                await apiRequest('admin_ban_user', {
                                    target_user_id: u.userId,
                                    banned: false,
                                });
                                showToast(`Unbanned ${u.username}.`, 'success');
                                await fetchAndRenderAdminUsers();
                            } catch (err) {
                                showToast(err.message, 'error');
                            }
                        }
                    });
                });
            }

            // Wire delete
            const deleteBtn = card.querySelector('.delete-btn');
            if (deleteBtn && !isSelf) {
                deleteBtn.addEventListener('click', () => {
                    adminState.targetUser = u;
                    dom.adminDeleteTargetDisplay.textContent = u.username;
                    dom.adminDeleteModal.classList.remove('hidden');
                });
            }

            dom.adminUserList.appendChild(card);
        });
    }

    // ======================= ADMIN SAVED CHATS =======================
    async function fetchAndRenderAdminChats() {
        try {
            const res = await apiRequest('admin_list_chats');
            if (res.chats) {
                adminState.chats = res.chats;
                renderAdminChatsList();
            }
        } catch (err) {
            showToast(err.message || 'Failed to load saved chats', 'error');
        }
    }

    function renderAdminChatsList() {
        if (!dom.adminChatsList) return;
        const search = (dom.adminChatsSearchInput ? dom.adminChatsSearchInput.value : '').toLowerCase().trim();

        const filtered = adminState.chats.filter(c => {
            if (!search) return true;
            return c.name.toLowerCase().includes(search) || c.roomId.toLowerCase().includes(search);
        });

        const totalChats = adminState.chats.length;
        const totalMsgs = adminState.chats.reduce((acc, c) => acc + c.messageCount, 0);
        const totalBytes = adminState.chats.reduce((acc, c) => acc + c.totalBytes, 0);

        if (dom.adminChatsStatCount) dom.adminChatsStatCount.textContent = `${totalChats} chat${totalChats !== 1 ? 's' : ''}`;
        if (dom.adminChatsStatMsgs) dom.adminChatsStatMsgs.textContent = `${totalMsgs} message${totalMsgs !== 1 ? 's' : ''}`;
        if (dom.adminChatsStatSize) dom.adminChatsStatSize.textContent = formatBytes(totalBytes);
        if (dom.adminTotalLabel) dom.adminTotalLabel.textContent = `Total Saved Chats: ${totalChats} (${formatBytes(totalBytes)})`;

        if (dom.adminChatsEmptyMsg) {
            dom.adminChatsEmptyMsg.classList.toggle('hidden', filtered.length > 0);
        }

        dom.adminChatsList.innerHTML = '';
        filtered.forEach(chat => {
            const card = document.createElement('div');
            card.className = 'admin-chat-card';

            const lastActive = chat.lastActivity ? formatTimestamp(chat.lastActivity) : 'Unknown';
            const isDm = (chat.type === 'dm');

            card.innerHTML = `
                <div class="admin-chat-info">
                    <div class="admin-chat-icon ${isDm ? 'is-dm' : ''}">
                        ${isDm ? '@' : '#'}
                    </div>
                    <div class="admin-chat-meta">
                        <div class="admin-chat-title-row">
                            <span class="admin-chat-name">${escapeHtml(chat.name)}</span>
                            <span class="admin-badge-mini" style="${isDm ? 'color:#8fa3ff; background:rgba(88,101,242,0.18); border-color:rgba(88,101,242,0.4);' : ''}">${isDm ? 'Direct Message' : 'Channel'}</span>
                        </div>
                        <div class="admin-chat-subrow">
                            <span>${chat.messageCount} message${chat.messageCount !== 1 ? 's' : ''}</span>
                            <span>•</span>
                            <span>Storage Footprint: <strong style="color: #ffbe76;">${formatBytes(chat.totalBytes)}</strong></span>
                            <span>•</span>
                            <span>Last active: ${lastActive}</span>
                        </div>
                    </div>
                </div>
                <div class="admin-user-actions">
                    <button type="button" class="btn-danger tiny delete-chat-btn" title="Permanently delete this chat history">Delete Chat</button>
                </div>
            `;

            card.querySelector('.delete-chat-btn').addEventListener('click', () => {
                showAdminConfirm({
                    title: `Delete Chat "${chat.name}"`,
                    message: `Are you sure you want to permanently delete all saved messages for "${chat.name}"?`,
                    subtext: `This will erase ${chat.messageCount} message(s) and free ${formatBytes(chat.totalBytes)} of storage. This action cannot be undone.`,
                    confirmBtnText: 'Delete Chat',
                    isDanger: true,
                    onConfirm: async () => {
                        try {
                            await apiRequest('admin_delete_chat', { room_id: chat.roomId });
                            showToast(`Deleted chat history for "${chat.name}".`, 'success');
                            if (state.activeTextRoomId === chat.roomId) {
                                resetAndRenderMessages([]);
                            }
                            await fetchAndRenderAdminChats();
                        } catch (err) {
                            showToast(err.message || 'Failed to delete chat', 'error');
                        }
                    }
                });
            });

            dom.adminChatsList.appendChild(card);
        });
    }

    // ======================= ADMIN UPLOADS STORAGE =======================
    async function fetchAndRenderAdminUploads() {
        try {
            const res = await apiRequest('admin_list_uploads');
            if (res.uploads) {
                adminState.uploads = res.uploads;
                renderAdminUploadsList(res);
            }
        } catch (err) {
            showToast(err.message || 'Failed to load uploads', 'error');
        }
    }

    function renderAdminUploadsList(stats = {}) {
        if (!dom.adminUploadsList) return;

        const totalCount = stats.totalCount !== undefined ? stats.totalCount : adminState.uploads.length;
        const totalBytes = stats.totalBytes !== undefined ? stats.totalBytes : adminState.uploads.reduce((a, u) => a + u.sizeBytes, 0);
        const staleCount = stats.olderThan2WeeksCount !== undefined ? stats.olderThan2WeeksCount : adminState.uploads.filter(u => u.isOlderThan2Weeks).length;

        if (dom.adminUploadsStatCount) dom.adminUploadsStatCount.textContent = `${totalCount} upload${totalCount !== 1 ? 's' : ''}`;
        if (dom.adminUploadsStatSize) dom.adminUploadsStatSize.textContent = formatBytes(totalBytes);
        if (dom.adminUploadsStatStale) dom.adminUploadsStatStale.textContent = staleCount;
        if (dom.adminTotalLabel) dom.adminTotalLabel.textContent = `Total Uploads: ${totalCount} (${formatBytes(totalBytes)})`;

        if (dom.adminPruneUploadsBtn) {
            dom.adminPruneUploadsBtn.disabled = (staleCount === 0);
            dom.adminPruneUploadsBtn.style.opacity = (staleCount === 0) ? '0.5' : '1';
        }

        if (dom.adminUploadsEmptyMsg) {
            dom.adminUploadsEmptyMsg.classList.toggle('hidden', adminState.uploads.length > 0);
        }

        dom.adminUploadsList.innerHTML = '';
        adminState.uploads.forEach(upload => {
            const card = document.createElement('div');
            card.className = 'admin-upload-card';

            const uploadedAt = upload.createdAt ? formatTimestamp(upload.createdAt) : 'Unknown';
            const staleBadge = upload.isOlderThan2Weeks ? '<span class="badge-stale">&gt; 2 Weeks Old</span>' : '';

            const ext = (upload.filename.split('.').pop() || '').toLowerCase();
            const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext);
            const thumbHtml = isImage
                ? `<img src="${escapeHtml(upload.url)}" alt="${escapeHtml(upload.filename)}" class="admin-upload-thumb" title="Click to view full image" loading="lazy">`
                : `<div class="admin-upload-thumb file-icon-badge file-badge-${ext}" style="cursor: pointer; width: 44px; height: 44px; font-size: 1.3rem;" title="Click to open file">${getFileIconMarkup(ext)}</div>`;

            card.innerHTML = `
                <div class="admin-upload-info">
                    ${thumbHtml}
                    <div class="admin-upload-meta">
                        <div class="admin-upload-title-row">
                            <span class="admin-upload-name" title="${escapeHtml(upload.displayName || upload.filename)}">${escapeHtml(upload.displayName || upload.filename)}</span>
                            ${staleBadge}
                        </div>
                        <div class="admin-upload-subrow">
                            <span>Size: <strong style="color: #ffbe76;">${formatBytes(upload.sizeBytes)}</strong></span>
                            <span>•</span>
                            <span>By: ${escapeHtml(upload.username)}</span>
                            <span>•</span>
                            <span>Room: #${escapeHtml(upload.roomId)}</span>
                            <span>•</span>
                            <span>Uploaded: ${uploadedAt}</span>
                        </div>
                    </div>
                </div>
                <div class="admin-user-actions">
                    <button type="button" class="btn-danger tiny delete-upload-btn" title="Permanently delete this uploaded file">Delete</button>
                </div>
            `;

            // Open in lightbox or new tab on thumb click
            const thumbEl = card.querySelector('.admin-upload-thumb');
            if (thumbEl) {
                thumbEl.addEventListener('click', () => {
                    if (isImage) {
                        openImageLightbox(upload.url);
                    } else {
                        window.open(upload.url, '_blank');
                    }
                });
            }

            // Single upload delete with confirmation
            card.querySelector('.delete-upload-btn').addEventListener('click', () => {
                showAdminConfirm({
                    title: `Delete Upload "${upload.filename}"`,
                    message: `Are you sure you want to permanently delete "${upload.filename}"?`,
                    subtext: `This will erase the file (${formatBytes(upload.sizeBytes)}) from disk and remove its message history.`,
                    confirmBtnText: 'Delete File',
                    isDanger: true,
                    onConfirm: async () => {
                        try {
                            await apiRequest('admin_delete_upload', { filename: upload.filename });
                            showToast(`Deleted ${upload.filename}.`, 'success');
                            await fetchAndRenderAdminUploads();
                        } catch (err) {
                            showToast(err.message || 'Failed to delete upload', 'error');
                        }
                    }
                });
            });

            dom.adminUploadsList.appendChild(card);
        });
    }

    function bindAdminEvents() {
        if (dom.openAdminBtn) dom.openAdminBtn.addEventListener('click', openAdminModal);
        if (dom.settingsOpenAdminBtn) dom.settingsOpenAdminBtn.addEventListener('click', openAdminModal);
        if (dom.closeAdminBtn) dom.closeAdminBtn.addEventListener('click', closeAdminModal);
        if (dom.doneAdminBtn) dom.doneAdminBtn.addEventListener('click', closeAdminModal);

        if (dom.adminModal) {
            dom.adminModal.addEventListener('click', (e) => {
                if (e.target === dom.adminModal) closeAdminModal();
            });
        }

        // Admin Tab switching
        document.querySelectorAll('.admin-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.adminTab;
                if (tab) switchAdminTab(tab);
            });
        });

        // Members Search
        if (dom.adminSearchInput) {
            dom.adminSearchInput.addEventListener('input', (e) => {
                adminState.search = e.target.value;
                renderAdminUserList();
            });
        }

        // Chats Search
        if (dom.adminChatsSearchInput) {
            dom.adminChatsSearchInput.addEventListener('input', () => {
                renderAdminChatsList();
            });
        }

        // Prune Uploads Older than 2 Weeks
        if (dom.adminPruneUploadsBtn) {
            dom.adminPruneUploadsBtn.addEventListener('click', () => {
                const staleUploads = adminState.uploads.filter(u => u.isOlderThan2Weeks);
                const staleCount = staleUploads.length;
                const staleBytes = staleUploads.reduce((a, u) => a + u.sizeBytes, 0);

                if (staleCount === 0) {
                    showToast('No uploads older than 2 weeks found.', 'info');
                    return;
                }

                showAdminConfirm({
                    title: 'Prune Uploads Older than 2 Weeks',
                    message: `Are you sure you want to delete all ${staleCount} uploaded image(s) older than 14 days?`,
                    subtext: `This will permanently delete ${staleCount} file(s) and free approximately ${formatBytes(staleBytes)} of server storage. This action cannot be undone.`,
                    confirmBtnText: 'Prune 2+ Week Uploads',
                    isDanger: true,
                    onConfirm: async () => {
                        try {
                            const res = await apiRequest('admin_prune_uploads');
                            showToast(`Successfully pruned ${res.deletedCount || staleCount} file(s) (freed ${formatBytes(res.freedBytes || staleBytes)}).`, 'success');
                            await fetchAndRenderAdminUploads();
                        } catch (err) {
                            showToast(err.message || 'Failed to prune uploads', 'error');
                        }
                    }
                });
            });
        }

        // Generic Confirmation Modal Events
        if (dom.closeConfirmModalBtn) dom.closeConfirmModalBtn.addEventListener('click', closeAdminConfirmModal);
        if (dom.cancelConfirmModalBtn) dom.cancelConfirmModalBtn.addEventListener('click', closeAdminConfirmModal);
        if (dom.proceedConfirmModalBtn) {
            dom.proceedConfirmModalBtn.addEventListener('click', () => {
                const cb = adminState.confirmCallback;
                closeAdminConfirmModal();
                if (typeof cb === 'function') {
                    cb();
                }
            });
        }
        if (dom.adminConfirmModal) {
            dom.adminConfirmModal.addEventListener('click', (e) => {
                if (e.target === dom.adminConfirmModal) closeAdminConfirmModal();
            });
        }

        const pills = document.querySelectorAll('.admin-filter-pill');
        pills.forEach(pill => {
            pill.addEventListener('click', () => {
                pills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                adminState.filter = pill.dataset.filter || 'all';
                renderAdminUserList();
            });
        });

        // Rename dialog events
        if (dom.closeRenameModalBtn) dom.closeRenameModalBtn.addEventListener('click', closeAdminSubModals);
        if (dom.cancelRenameModalBtn) dom.cancelRenameModalBtn.addEventListener('click', closeAdminSubModals);
        if (dom.adminRenameModal) {
            dom.adminRenameModal.addEventListener('click', (e) => {
                if (e.target === dom.adminRenameModal) closeAdminSubModals();
            });
        }
        if (dom.adminRenameForm) {
            dom.adminRenameForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!adminState.targetUser) return;
                const newName = dom.adminRenameInput.value.trim();
                if (newName.length < 2) {
                    showToast('Username must be at least 2 characters long.', 'error');
                    return;
                }
                try {
                    await apiRequest('admin_rename_user', {
                        target_user_id: adminState.targetUser.userId,
                        new_username: newName,
                    });
                    showToast(`Renamed member to "${newName}".`, 'success');
                    closeAdminSubModals();
                    await fetchAndRenderAdminUsers();
                    if (state.user && state.user.userId === adminState.targetUser.userId) {
                        state.user.username = newName;
                        renderCurrentUserBar();
                    }
                } catch (err) {
                    showToast(err.message, 'error');
                }
            });
        }

        // Ban dialog events
        if (dom.closeBanModalBtn) dom.closeBanModalBtn.addEventListener('click', closeAdminSubModals);
        if (dom.cancelBanModalBtn) dom.cancelBanModalBtn.addEventListener('click', closeAdminSubModals);
        if (dom.adminBanModal) {
            dom.adminBanModal.addEventListener('click', (e) => {
                if (e.target === dom.adminBanModal) closeAdminSubModals();
            });
        }
        if (dom.adminBanForm) {
            dom.adminBanForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!adminState.targetUser) return;
                const reason = dom.adminBanReasonInput.value.trim();
                try {
                    await apiRequest('admin_ban_user', {
                        target_user_id: adminState.targetUser.userId,
                        banned: true,
                        reason: reason,
                    });
                    showToast(`Banned user "${adminState.targetUser.username}".`, 'success');
                    closeAdminSubModals();
                    await fetchAndRenderAdminUsers();
                } catch (err) {
                    showToast(err.message, 'error');
                }
            });
        }

        // Delete dialog events
        if (dom.closeDeleteModalBtn) dom.closeDeleteModalBtn.addEventListener('click', closeAdminSubModals);
        if (dom.cancelDeleteModalBtn) dom.cancelDeleteModalBtn.addEventListener('click', closeAdminSubModals);
        if (dom.adminDeleteModal) {
            dom.adminDeleteModal.addEventListener('click', (e) => {
                if (e.target === dom.adminDeleteModal) closeAdminSubModals();
            });
        }
        if (dom.adminDeleteForm) {
            dom.adminDeleteForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!adminState.targetUser) return;
                const uid = adminState.targetUser.userId;
                const uName = adminState.targetUser.username;
                try {
                    await apiRequest('admin_delete_user', {
                        target_user_id: uid,
                    });
                    state.members = state.members.filter(m => m.userId !== uid);
                    state.contacts = state.contacts.filter(c => c.userId !== uid);
                    renderMembersList();
                    renderContactsList();
                    showToast(`User "${uName}" permanently deleted.`, 'success');
                    closeAdminSubModals();
                    await fetchAndRenderAdminUsers();
                } catch (err) {
                    showToast(err.message, 'error');
                }
            });
        }
    }

    // Boot
    document.addEventListener('DOMContentLoaded', async () => {
        bindAuthEvents();
        bindWorkspaceEvents();
        bindAdminEvents();

        if (state.authToken) {
            await enterWorkspace();
        }
    });
})();
