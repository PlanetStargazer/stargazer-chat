<?php
declare(strict_types=1);

/**
 * Stargazer Chat Backend — Accounts, Channels, Contacts, Text Chat & 6-Peer Video/Voice
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

@ini_set('upload_max_filesize', '128M');
@ini_set('post_max_size', '135M');
@ini_set('memory_limit', '256M');

const MAX_ROOM_PARTICIPANTS = 6;
const PARTICIPANT_TIMEOUT_SECONDS = 18;
const USER_ONLINE_TIMEOUT_SECONDS = 25;
const SIGNAL_TTL_SECONDS = 60;
const SESSION_LIFETIME_SECONDS = 5184000; // 60 days persistent login
const SESSION_ROLLING_RENEW_SECONDS = 1209600; // 14 days auto-renewal threshold
const MAX_UPLOAD_BYTES = 134217728; // 128 MB (128 * 1024 * 1024)
const IMAGE_RETENTION_SECONDS = 604800; // 7 days (1 week)

function safeSubstr(string $str, int $start, int $length): string
{
    if (function_exists('mb_substr')) {
        return mb_substr($str, $start, $length, 'UTF-8');
    }
    if (preg_match_all('/./us', $str, $matches)) {
        return implode('', array_slice($matches[0], $start, $length));
    }
    return substr($str, $start, $length);
}

function safeStrlen(string $str): int
{
    if (function_exists('mb_strlen')) {
        return mb_strlen($str, 'UTF-8');
    }
    if (preg_match_all('/./us', $str, $matches)) {
        return count($matches[0]);
    }
    return strlen($str);
}

class ChatDatabase
{
    private $pdo = null;
    private $sqlite3 = null;

    public function __construct(string $dbPath)
    {
        $dir = dirname($dbPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        if (extension_loaded('pdo_sqlite')) {
            $this->pdo = new PDO('sqlite:' . $dbPath, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_TIMEOUT => 5,
            ]);
            $this->pdo->exec('PRAGMA journal_mode = WAL;');
            $this->pdo->exec('PRAGMA synchronous = NORMAL;');
            $this->pdo->exec('PRAGMA foreign_keys = ON;');
            $this->pdo->exec('PRAGMA busy_timeout = 5000;');
        } elseif (extension_loaded('sqlite3')) {
            $this->sqlite3 = new SQLite3($dbPath);
            $this->sqlite3->busyTimeout(5000);
            $this->sqlite3->exec('PRAGMA journal_mode = WAL;');
            $this->sqlite3->exec('PRAGMA synchronous = NORMAL;');
            $this->sqlite3->exec('PRAGMA foreign_keys = ON;');
        } else {
            http_response_code(500);
            echo json_encode([
                'ok' => false,
                'error' => 'Database extension is not enabled on this server.'
            ]);
            exit;
        }

        $this->initSchema();
    }

    private function initSchema(): void
    {
        $schema = <<<SQL
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    avatar_color TEXT NOT NULL DEFAULT '#5865f2',
    auth_token TEXT NOT NULL DEFAULT '',
    current_room TEXT NOT NULL DEFAULT '',
    last_seen INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'online'
);

CREATE INDEX IF NOT EXISTS idx_users_token ON users(auth_token);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);

CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_info TEXT NOT NULL DEFAULT '',
    ip_address TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_active INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS channels (
    channel_id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
    owner_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, friend_id)
);

CREATE TABLE IF NOT EXISTS call_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_color TEXT NOT NULL DEFAULT '#5865f2',
    sender_avatar TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    room_label TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'video',
    status TEXT NOT NULL DEFAULT 'pending',
    accepted_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invites_target ON call_invites(target_id, id);

CREATE TABLE IF NOT EXISTS participants (
    peer_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT '',
    room_id TEXT NOT NULL,
    username TEXT NOT NULL,
    avatar_color TEXT NOT NULL DEFAULT '#5865f2',
    avatar_url TEXT NOT NULL DEFAULT '',
    mic_enabled INTEGER NOT NULL DEFAULT 1,
    cam_enabled INTEGER NOT NULL DEFAULT 1,
    screen_sharing INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_participants_room ON participants(room_id, last_seen);

CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signals_target ON signals(target_id, id);
CREATE INDEX IF NOT EXISTS idx_signals_room ON signals(room_id, target_id, id);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL,
    avatar_color TEXT NOT NULL DEFAULT '#5865f2',
    avatar_url TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    edited_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, id);

CREATE TABLE IF NOT EXISTS url_previews (
    url TEXT PRIMARY KEY,
    image_url TEXT,
    title TEXT,
    description TEXT,
    domain TEXT,
    is_image INTEGER DEFAULT 0,
    created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_url_previews_time ON url_previews(created_at);
SQL;
        $this->exec($schema);

        // Remove legacy fallback tables if previously created
        $this->exec('DROP TABLE IF EXISTS media_frames');
        $this->exec('DROP TABLE IF EXISTS audio_chunks');

        // Migrate users & messages table columns if needed
        try {
            $this->exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
        } catch (\Throwable $e) {}

        try {
            $this->exec('ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0');
        } catch (\Throwable $e) {}

        try {
            $this->exec('ALTER TABLE users ADD COLUMN ban_reason TEXT NOT NULL DEFAULT ""');
        } catch (\Throwable $e) {}

        try {
            $this->exec('ALTER TABLE messages ADD COLUMN edited_at INTEGER NOT NULL DEFAULT 0');
        } catch (\Throwable $e) {}

        // Ensure uploads directory exists
        $uploadDir = __DIR__ . '/uploads';
        if (!is_dir($uploadDir)) {
            @mkdir($uploadDir, 0755, true);
        }

        // Ensure at least one admin exists (make the earliest registered user an administrator)
        $adminCount = $this->queryOne('SELECT COUNT(*) AS cnt FROM users WHERE is_admin = 1');
        if (!$adminCount || (int)$adminCount['cnt'] === 0) {
            $firstUser = $this->queryOne('SELECT user_id FROM users ORDER BY created_at ASC LIMIT 1');
            if ($firstUser && !empty($firstUser['user_id'])) {
                $this->execute('UPDATE users SET is_admin = 1 WHERE user_id = :uid', [':uid' => $firstUser['user_id']]);
            }
        }

        // Migrate any existing users with legacy auth_token into user_sessions
        $legacyUsers = $this->queryAll("SELECT user_id, auth_token, created_at FROM users WHERE auth_token != ''");
        foreach ($legacyUsers as $lu) {
            $raw = (string)$lu['auth_token'];
            $hash = hash('sha256', $raw);
            $this->execute(
                'INSERT OR IGNORE INTO user_sessions (token_hash, user_id, device_info, ip_address, created_at, last_active, expires_at)
                 VALUES (:hash, :uid, "Active Session", "", :created, :now, :expires)',
                [
                    ':hash' => $hash,
                    ':uid' => $lu['user_id'],
                    ':created' => (int)($lu['created_at'] ?: time()),
                    ':now' => time(),
                    ':expires' => time() + SESSION_LIFETIME_SECONDS,
                ]
            );
        }

        // Ensure default channels exist on fresh install
        $existingChannels = $this->queryOne('SELECT COUNT(*) AS cnt FROM channels');
        if (!$existingChannels || (int)$existingChannels['cnt'] === 0) {
            $now = time();
            $this->execute(
                'INSERT OR IGNORE INTO channels (channel_id, name, created_by, created_at) VALUES (:id, :name, :by, :at)',
                [':id' => 'general', ':name' => 'general', ':by' => 'system', ':at' => $now]
            );
            $this->execute(
                'INSERT OR IGNORE INTO channels (channel_id, name, created_by, created_at) VALUES (:id, :name, :by, :at)',
                [':id' => 'lounge', ':name' => 'lounge', ':by' => 'system', ':at' => $now + 1]
            );
        }

        // Consolidate and tie together any legacy/split DM chat rooms across tables
        try {
            $dmRooms = $this->queryAll('SELECT DISTINCT room_id FROM messages WHERE room_id LIKE "dm-%"');
            foreach ($dmRooms as $r) {
                $oldRoomId = (string)$r['room_id'];
                $canonical = sanitizeRoomId($oldRoomId);
                if ($canonical !== $oldRoomId) {
                    $this->execute('UPDATE messages SET room_id = :canonical WHERE room_id = :old', [
                        ':canonical' => $canonical,
                        ':old' => $oldRoomId,
                    ]);
                }
            }

            $inviteRooms = $this->queryAll('SELECT DISTINCT room_id FROM call_invites WHERE room_id LIKE "dm-%"');
            foreach ($inviteRooms as $r) {
                $oldRoomId = (string)$r['room_id'];
                $canonical = sanitizeRoomId($oldRoomId);
                if ($canonical !== $oldRoomId) {
                    $this->execute('UPDATE call_invites SET room_id = :canonical WHERE room_id = :old', [
                        ':canonical' => $canonical,
                        ':old' => $oldRoomId,
                    ]);
                }
            }

            $sigRooms = $this->queryAll('SELECT DISTINCT room_id FROM signals WHERE room_id LIKE "dm-%"');
            foreach ($sigRooms as $r) {
                $oldRoomId = (string)$r['room_id'];
                $canonical = sanitizeRoomId($oldRoomId);
                if ($canonical !== $oldRoomId) {
                    $this->execute('UPDATE signals SET room_id = :canonical WHERE room_id = :old', [
                        ':canonical' => $canonical,
                        ':old' => $oldRoomId,
                    ]);
                }
            }

            // Clean up any orphan messages left behind in channels that no longer exist
            $this->exec('DELETE FROM messages WHERE room_id NOT LIKE "dm-%" AND room_id NOT IN (SELECT channel_id FROM channels)');

            // Ensure status column in users table
            $cols = $this->queryAll("PRAGMA table_info(users)");
            $colNames = array_column($cols, 'name');
            if (!in_array('status', $colNames, true)) {
                $this->exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'online'");
            }

            // Ensure status and accepted_at columns in call_invites table
            $inviteCols = $this->queryAll("PRAGMA table_info(call_invites)");
            $inviteColNames = array_column($inviteCols, 'name');
            if (!in_array('status', $inviteColNames, true)) {
                $this->exec("ALTER TABLE call_invites ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
            }
            if (!in_array('accepted_at', $inviteColNames, true)) {
                $this->exec("ALTER TABLE call_invites ADD COLUMN accepted_at INTEGER NOT NULL DEFAULT 0");
            }
        } catch (\Throwable $e) {}
    }

    public function exec(string $sql): void
    {
        if ($this->pdo) {
            $this->pdo->exec($sql);
        } else {
            $this->sqlite3->exec($sql);
        }
    }

    public function queryAll(string $sql, array $params = []): array
    {
        if ($this->pdo) {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            return $stmt->fetchAll();
        }

        $stmt = $this->sqlite3->prepare($sql);
        foreach ($params as $key => $val) {
            $paramName = is_int($key) ? $key + 1 : (str_starts_with((string)$key, ':') ? $key : ':' . $key);
            $stmt->bindValue($paramName, $val);
        }
        $res = $stmt->execute();
        $rows = [];
        while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
            $rows[] = $row;
        }
        $res->finalize();
        $stmt->close();
        return $rows;
    }

    public function queryOne(string $sql, array $params = []): ?array
    {
        $rows = $this->queryAll($sql, $params);
        return $rows[0] ?? null;
    }

    public function execute(string $sql, array $params = []): int
    {
        if ($this->pdo) {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            return (int)$this->pdo->lastInsertId();
        }

        $stmt = $this->sqlite3->prepare($sql);
        foreach ($params as $key => $val) {
            $paramName = is_int($key) ? $key + 1 : (str_starts_with((string)$key, ':') ? $key : ':' . $key);
            $stmt->bindValue($paramName, $val);
        }
        $res = $stmt->execute();
        if ($res) {
            $res->finalize();
        }
        $stmt->close();
        return (int)$this->sqlite3->lastInsertRowID();
    }
}

function respond(array $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function sanitizeRoomId(string $room): string
{
    $clean = strtolower(trim($room));
    $clean = preg_replace('/[^a-z0-9_-]/', '-', $clean) ?? 'general';
    $clean = trim($clean, '-');

    // Deterministically canonicalize direct message rooms (dm-userA-userB)
    // so both participants always share the exact same room ID regardless of who started the chat
    if (preg_match('/^dm-([a-z0-9_]+)-([a-z0-9_]+)$/', $clean, $matches)) {
        $u1 = $matches[1];
        $u2 = $matches[2];
        $pair = [$u1, $u2];
        sort($pair, SORT_STRING);
        return 'dm-' . $pair[0] . '-' . $pair[1];
    }

    return $clean !== '' ? substr($clean, 0, 64) : 'general';
}

function sanitizeChannelName(string $name): string
{
    $clean = strtolower(trim(strip_tags($name)));
    $clean = preg_replace('/\s+/', '-', $clean) ?? '';
    $clean = preg_replace('/[^a-z0-9_-]/', '', $clean) ?? '';
    $clean = trim($clean, '-');
    return safeSubstr($clean, 0, 32);
}

function sanitizeUsername(string $name): string
{
    $clean = trim(strip_tags($name));
    $clean = preg_replace('/\s+/', ' ', $clean) ?? '';
    return safeSubstr($clean, 0, 28);
}

function pickDefaultColor(string $seed): string
{
    $palette = ['#c85a9e', '#8c52b5', '#cf7b38', '#2b8c9e', '#b04382', '#d46a6a', '#6d4c9c', '#c98a3e'];
    return $palette[abs(crc32(strtolower($seed))) % count($palette)];
}

function formatUserPublic(array $u): array
{
    return [
        'userId' => (string)$u['user_id'],
        'username' => (string)$u['username'],
        'email' => (string)$u['email'],
        'avatarUrl' => (string)$u['avatar_url'],
        'avatarColor' => (string)$u['avatar_color'],
        'status' => in_array((string)($u['status'] ?? 'online'), ['online', 'away', 'dnd'], true) ? (string)$u['status'] : 'online',
        'isAdmin' => !empty($u['is_admin']),
        'isBanned' => !empty($u['is_banned']),
        'banReason' => (string)($u['ban_reason'] ?? ''),
    ];
}

function createUserSession(ChatDatabase $db, string $userId, array $input = []): string
{
    $rawToken = bin2hex(random_bytes(32));
    $tokenHash = hash('sha256', $rawToken);
    $now = time();
    $expires = $now + SESSION_LIFETIME_SECONDS;
    $userAgent = substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ($input['device_info'] ?? 'Web Client')), 0, 180);
    $ip = substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);

    $db->execute(
        'INSERT INTO user_sessions (token_hash, user_id, device_info, ip_address, created_at, last_active, expires_at)
         VALUES (:hash, :uid, :device, :ip, :now, :now, :expires)',
        [
            ':hash' => $tokenHash,
            ':uid' => $userId,
            ':device' => $userAgent,
            ':ip' => $ip,
            ':now' => $now,
            ':expires' => $expires,
        ]
    );

    // Update user last_seen
    $db->execute('UPDATE users SET last_seen = :now WHERE user_id = :uid', [
        ':now' => $now,
        ':uid' => $userId,
    ]);

    return $rawToken;
}

function requireAuthenticatedUser(ChatDatabase $db, array $input): array
{
    $token = trim((string)($input['auth_token'] ?? $_POST['auth_token'] ?? $_GET['auth_token'] ?? ''));
    if ($token === '') {
        respond(['ok' => false, 'error' => 'Authentication required.', 'code' => 'UNAUTHORIZED'], 401);
    }

    $tokenHash = hash('sha256', $token);
    $now = time();

    // Look up active session
    $session = $db->queryOne(
        'SELECT s.*, u.*
         FROM user_sessions s
         INNER JOIN users u ON u.user_id = s.user_id
         WHERE s.token_hash = :hash AND s.expires_at > :now',
        [':hash' => $tokenHash, ':now' => $now]
    );

    // Fallback: check legacy users.auth_token if migrating
    if (!$session) {
        $legacyUser = $db->queryOne('SELECT * FROM users WHERE auth_token = :token', [':token' => $token]);
        if ($legacyUser) {
            $expires = $now + SESSION_LIFETIME_SECONDS;
            $db->execute(
                'INSERT OR REPLACE INTO user_sessions (token_hash, user_id, device_info, ip_address, created_at, last_active, expires_at)
                 VALUES (:hash, :uid, "Active Session", "", :now, :now, :expires)',
                [
                    ':hash' => $tokenHash,
                    ':uid' => $legacyUser['user_id'],
                    ':now' => $now,
                    ':expires' => $expires,
                ]
            );
            $session = $legacyUser;
            $session['expires_at'] = $expires;
        }
    }

    if (!$session) {
        respond(['ok' => false, 'error' => 'Session expired. Please sign in again.', 'code' => 'UNAUTHORIZED'], 401);
    }

    if (!empty($session['is_banned'])) {
        $reason = !empty($session['ban_reason']) ? (': ' . $session['ban_reason']) : '.';
        respond(['ok' => false, 'error' => 'Your account has been banned' . $reason, 'code' => 'BANNED'], 403);
    }

    // Rolling renewal: if session is within 14 days of expiry, extend by another 60 days
    $expiresAt = (int)($session['expires_at'] ?? 0);
    $newExpiresAt = ($expiresAt - $now < SESSION_ROLLING_RENEW_SECONDS) ? ($now + SESSION_LIFETIME_SECONDS) : $expiresAt;

    $db->execute(
        'UPDATE user_sessions SET last_active = :now, expires_at = :expires WHERE token_hash = :hash',
        [':now' => $now, ':expires' => $newExpiresAt, ':hash' => $tokenHash]
    );

    $db->execute('UPDATE users SET last_seen = :now WHERE user_id = :uid', [
        ':now' => $now,
        ':uid' => $session['user_id'],
    ]);

    return $session;
}

function requireAdminUser(ChatDatabase $db, array $input): array
{
    $user = requireAuthenticatedUser($db, $input);
    if (empty($user['is_admin'])) {
        respond(['ok' => false, 'error' => 'Administrator privileges required.', 'code' => 'FORBIDDEN'], 403);
    }
    return $user;
}

function cleanupStaleData(ChatDatabase $db): void
{
    $now = time();
    $staleThreshold = $now - PARTICIPANT_TIMEOUT_SECONDS;

    $stalePeers = $db->queryAll(
        'SELECT peer_id, user_id, room_id, username, avatar_color, avatar_url FROM participants WHERE last_seen < :threshold',
        [':threshold' => $staleThreshold]
    );

    foreach ($stalePeers as $peer) {
        $db->execute('DELETE FROM participants WHERE peer_id = :peer_id', [':peer_id' => $peer['peer_id']]);
        $db->execute(
            'DELETE FROM signals WHERE sender_id = :peer_id OR target_id = :peer_id',
            [':peer_id' => $peer['peer_id']]
        );
        if (!empty($peer['user_id'])) {
            $db->execute('UPDATE users SET current_room = "" WHERE user_id = :uid', [':uid' => $peer['user_id']]);
        }
    }

    $db->execute('DELETE FROM signals WHERE created_at < :sig_threshold', [':sig_threshold' => $now - SIGNAL_TTL_SECONDS]);
    $db->execute('DELETE FROM user_sessions WHERE expires_at < :now', [':now' => $now]);

    // Clean up uploaded files/images and messages older than 7 days (1 week)
    $uploadCutoff = $now - IMAGE_RETENTION_SECONDS;
    $staleUploads = $db->queryAll(
        'SELECT id, type, content FROM messages WHERE type IN ("image", "file") AND created_at < :cutoff',
        [':cutoff' => $uploadCutoff]
    );
    foreach ($staleUploads as $item) {
        $raw = (string)$item['content'];
        $relPath = $raw;
        if (str_starts_with($raw, '{')) {
            $parsed = json_decode($raw, true);
            if (!empty($parsed['url'])) $relPath = (string)$parsed['url'];
        }
        $filePath = __DIR__ . '/' . ltrim($relPath, '/\\');
        if (file_exists($filePath) && is_file($filePath)) {
            @unlink($filePath);
        }
    }
    if (!empty($staleUploads)) {
        $db->execute('DELETE FROM messages WHERE type IN ("image", "file") AND created_at < :cutoff', [':cutoff' => $uploadCutoff]);
    }

    // Clean up old cached URL previews older than 7 days
    $db->execute('DELETE FROM url_previews WHERE created_at < :cutoff', [':cutoff' => $now - 604800]);

    // Also scan uploads directory for any orphan/temporary files older than 7 days
    $uploadDir = __DIR__ . '/uploads';
    if (is_dir($uploadDir)) {
        $files = glob($uploadDir . '/*');
        if (is_array($files)) {
            foreach ($files as $f) {
                if (is_file($f) && basename($f) !== '.gitkeep' && (filemtime($f) < $uploadCutoff)) {
                    @unlink($f);
                }
            }
        }
    }
}

function getAllChannelsWithVoicePeers(ChatDatabase $db): array
{
    $channels = $db->queryAll('SELECT channel_id, name, created_by, created_at FROM channels ORDER BY created_at ASC');
    $participants = $db->queryAll(
        'SELECT peer_id, user_id, room_id, username, avatar_color, avatar_url, mic_enabled, cam_enabled, screen_sharing
         FROM participants
         ORDER BY joined_at ASC'
    );

    $byRoom = [];
    foreach ($participants as $p) {
        $rid = (string)$p['room_id'];
        $byRoom[$rid][] = [
            'peerId' => (string)$p['peer_id'],
            'userId' => (string)$p['user_id'],
            'username' => (string)$p['username'],
            'avatarColor' => (string)$p['avatar_color'],
            'avatarUrl' => (string)$p['avatar_url'],
            'micEnabled' => (bool)$p['mic_enabled'],
            'camEnabled' => (bool)$p['cam_enabled'],
            'screenSharing' => (bool)$p['screen_sharing'],
        ];
    }

    return array_map(static function (array $ch) use ($byRoom): array {
        $cid = (string)$ch['channel_id'];
        return [
            'channelId' => $cid,
            'name' => (string)$ch['name'],
            'createdBy' => (string)$ch['created_by'],
            'voiceParticipants' => $byRoom[$cid] ?? [],
        ];
    }, $channels);
}

function getContactsForUser(ChatDatabase $db, string $userId): array
{
    $now = time();
    $onlineThreshold = $now - USER_ONLINE_TIMEOUT_SECONDS;

    $rows = $db->queryAll(
        'SELECT u.user_id, u.username, u.avatar_color, u.avatar_url, u.current_room, u.last_seen, u.is_admin, COALESCE(u.status, "online") as status
         FROM contacts c
         INNER JOIN users u ON u.user_id = c.friend_id
         WHERE c.owner_id = :owner_id AND u.is_banned = 0
         ORDER BY (u.last_seen >= :online_thresh) DESC, u.username COLLATE NOCASE ASC',
        [
            ':owner_id' => $userId,
            ':online_thresh' => $onlineThreshold,
        ]
    );

    return array_map(static function (array $row) use ($userId, $onlineThreshold): array {
        $friendId = (string)$row['user_id'];
        $lastSeen = (int)$row['last_seen'];
        $isOnline = $lastSeen >= $onlineThreshold;

        // Deterministic DM room ID between these two users
        $pair = [$userId, $friendId];
        sort($pair);
        $dmRoomId = 'dm-' . $pair[0] . '-' . $pair[1];

        $rawStatus = (string)($row['status'] ?? 'online');
        $effectiveStatus = $isOnline
            ? (in_array($rawStatus, ['online', 'away', 'dnd'], true) ? $rawStatus : 'online')
            : 'offline';

        return [
            'userId' => $friendId,
            'username' => (string)$row['username'],
            'avatarColor' => (string)$row['avatar_color'],
            'avatarUrl' => (string)$row['avatar_url'],
            'online' => $isOnline,
            'status' => $effectiveStatus,
            'currentRoom' => $isOnline ? (string)$row['current_room'] : '',
            'lastSeen' => $lastSeen,
            'dmRoomId' => $dmRoomId,
            'isAdmin' => !empty($row['is_admin']),
        ];
    }, $rows);
}

function getAllMembers(ChatDatabase $db, string $currentUserId): array
{
    $now = time();
    $onlineThreshold = $now - USER_ONLINE_TIMEOUT_SECONDS;

    $rows = $db->queryAll(
        'SELECT user_id, username, avatar_color, avatar_url, current_room, last_seen, is_admin, COALESCE(status, "online") as status
         FROM users
         WHERE is_banned = 0
         ORDER BY (last_seen >= :online_thresh) DESC, username COLLATE NOCASE ASC',
        [':online_thresh' => $onlineThreshold]
    );

    return array_map(static function (array $row) use ($currentUserId, $onlineThreshold): array {
        $uid = (string)$row['user_id'];
        $lastSeen = (int)$row['last_seen'];
        $isOnline = ($uid === $currentUserId) || ($lastSeen >= $onlineThreshold);

        $pair = [$currentUserId, $uid];
        sort($pair);
        $dmRoomId = 'dm-' . $pair[0] . '-' . $pair[1];

        $rawStatus = (string)($row['status'] ?? 'online');
        $effectiveStatus = $isOnline
            ? (in_array($rawStatus, ['online', 'away', 'dnd'], true) ? $rawStatus : 'online')
            : 'offline';

        return [
            'userId' => $uid,
            'username' => (string)$row['username'],
            'avatarColor' => (string)$row['avatar_color'],
            'avatarUrl' => (string)$row['avatar_url'],
            'online' => $isOnline,
            'status' => $effectiveStatus,
            'currentRoom' => $isOnline ? (string)$row['current_room'] : '',
            'lastSeen' => $lastSeen,
            'dmRoomId' => $dmRoomId,
            'isAdmin' => !empty($row['is_admin']),
        ];
    }, $rows);
}

function getPendingIncomingInvites(ChatDatabase $db, string $userId): array
{
    $now = time();
    // Clean up expired invites older than 60 seconds
    $db->execute('DELETE FROM call_invites WHERE created_at < :min_time', [':min_time' => $now - 60]);

    $rows = $db->queryAll(
        'SELECT id, sender_id, sender_name, sender_color, sender_avatar, room_id, room_label, mode, status, created_at
         FROM call_invites
         WHERE target_id = :target_id AND status = "pending" AND created_at >= :recent
         ORDER BY id ASC',
        [':target_id' => $userId, ':recent' => $now - 35]
    );

    return array_map(static function (array $row): array {
        return [
            'id' => (int)$row['id'],
            'senderId' => (string)$row['sender_id'],
            'senderName' => (string)$row['sender_name'],
            'senderColor' => (string)$row['sender_color'],
            'senderAvatar' => (string)$row['sender_avatar'],
            'roomId' => (string)$row['room_id'],
            'roomLabel' => (string)$row['room_label'],
            'mode' => (string)$row['mode'],
            'status' => (string)$row['status'],
            'createdAt' => (int)$row['created_at'],
        ];
    }, $rows);
}

function getOutgoingInviteStatus(ChatDatabase $db, string $userId): ?array
{
    $now = time();
    $row = $db->queryOne(
        'SELECT id, target_id, room_id, room_label, mode, status, created_at
         FROM call_invites
         WHERE sender_id = :uid AND created_at >= :recent
         ORDER BY id DESC LIMIT 1',
        [':uid' => $userId, ':recent' => $now - 45]
    );

    if (!$row) return null;

    return [
        'id' => (int)$row['id'],
        'targetId' => (string)$row['target_id'],
        'roomId' => (string)$row['room_id'],
        'roomLabel' => (string)$row['room_label'],
        'mode' => (string)$row['mode'],
        'status' => (string)$row['status'],
        'createdAt' => (int)$row['created_at'],
    ];
}

function getRoomParticipants(ChatDatabase $db, string $roomId): array
{
    $rows = $db->queryAll(
        'SELECT peer_id, user_id, username, avatar_color, avatar_url, mic_enabled, cam_enabled, screen_sharing, joined_at, last_seen
         FROM participants
         WHERE room_id = :room_id
         ORDER BY joined_at ASC, peer_id ASC',
        [':room_id' => $roomId]
    );

    return array_map(static function (array $row): array {
        return [
            'peerId' => (string)$row['peer_id'],
            'userId' => (string)$row['user_id'],
            'username' => (string)$row['username'],
            'avatarColor' => (string)$row['avatar_color'],
            'avatarUrl' => (string)$row['avatar_url'],
            'micEnabled' => (bool)$row['mic_enabled'],
            'camEnabled' => (bool)$row['cam_enabled'],
            'screenSharing' => (bool)$row['screen_sharing'],
            'joinedAt' => (int)$row['joined_at'],
            'lastSeen' => (int)$row['last_seen'],
        ];
    }, $rows);
}

function formatMessages(array $rows): array
{
    return array_map(static function (array $row): array {
        $content = (string)$row['content'];
        $mentions = [];
        if (preg_match_all('/@([a-zA-Z0-9_-]+)/', $content, $m)) {
            $mentions = array_values(array_unique($m[1]));
        }

        return [
            'id' => (int)$row['id'],
            'roomId' => (string)($row['room_id'] ?? ''),
            'peerId' => (string)$row['peer_id'],
            'userId' => (string)($row['user_id'] ?? ''),
            'username' => (string)$row['username'],
            'avatarColor' => (string)$row['avatar_color'],
            'avatarUrl' => (string)($row['avatar_url'] ?? ''),
            'type' => (string)$row['type'],
            'content' => $content,
            'mentions' => $mentions,
            'createdAt' => (int)$row['created_at'],
            'editedAt' => (int)($row['edited_at'] ?? 0),
        ];
    }, $rows);
}

function detectImageMime(string $filePath, string $originalName = ''): ?string
{
    // 1. Try finfo if available
    if (function_exists('finfo_open')) {
        $finfo = @finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo) {
            $mime = @finfo_file($finfo, $filePath);
            @finfo_close($finfo);
            if (!empty($mime) && $mime !== 'application/octet-stream') {
                return (string)$mime;
            }
        }
    }

    // 2. Try mime_content_type if available
    if (function_exists('mime_content_type')) {
        $mime = @mime_content_type($filePath);
        if (!empty($mime) && $mime !== 'application/octet-stream') {
            return (string)$mime;
        }
    }

    // 3. Try getimagesize
    $imgInfo = @getimagesize($filePath);
    if (!empty($imgInfo['mime'])) {
        return (string)$imgInfo['mime'];
    }

    // 4. Inspect magic bytes
    $handle = @fopen($filePath, 'rb');
    if ($handle) {
        $bytes = (string)fread($handle, 16);
        fclose($handle);
        if (str_starts_with($bytes, "\xFF\xD8\xFF")) return 'image/jpeg';
        if (str_starts_with($bytes, "\x89PNG\r\n\x1a\n")) return 'image/png';
        if (str_starts_with($bytes, 'GIF87a') || str_starts_with($bytes, 'GIF89a')) return 'image/gif';
        if (str_starts_with($bytes, 'RIFF') && substr($bytes, 8, 4) === 'WEBP') return 'image/webp';
        if (str_starts_with($bytes, '<svg') || str_starts_with($bytes, '<?xml')) return 'image/svg+xml';
    }

    // 5. Fallback: match by file extension
    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $extMap = [
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        'gif' => 'image/gif',
        'webp' => 'image/webp',
        'svg' => 'image/svg+xml',
        'avif' => 'image/avif',
    ];
    return $extMap[$ext] ?? null;
}

function getRecentMessages(ChatDatabase $db, string $roomId, int $limit = 80): array
{
    $rows = $db->queryAll(
        'SELECT * FROM (
            SELECT id, room_id, peer_id, user_id, username, avatar_color, avatar_url, type, content, created_at, edited_at
            FROM messages
            WHERE room_id = :room_id
            ORDER BY id DESC
            LIMIT ' . (int)$limit . '
        ) ORDER BY id ASC',
        [':room_id' => $roomId]
    );
    return formatMessages($rows);
}

try {
    $dbPath = __DIR__ . '/database/chat.sqlite';
    $db = new ChatDatabase($dbPath);

    $rawInput = file_get_contents('php://input');
    $input = $rawInput ? (json_decode($rawInput, true) ?? []) : [];
    if (!empty($_POST)) {
        $input = array_merge($input, $_POST);
    }
    $action = $_GET['action'] ?? ($input['action'] ?? ($_POST['action'] ?? 'status'));
    $now = time();

    switch ($action) {
        // ======================= AUTHENTICATION =======================
        case 'register': {
            $username = sanitizeUsername((string)($input['username'] ?? ''));
            $email = strtolower(trim((string)($input['email'] ?? '')));
            $password = (string)($input['password'] ?? '');
            $avatarUrl = (string)($input['avatar_url'] ?? '');

            if (safeStrlen($username) < 2) {
                respond(['ok' => false, 'error' => 'Username must be at least 2 characters long.'], 400);
            }
            if (!preg_match('/^[a-zA-Z0-9_.\- ]+$/', $username)) {
                respond(['ok' => false, 'error' => 'Username may only contain letters, numbers, spaces, dots, hyphens, and underscores.'], 400);
            }
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                respond(['ok' => false, 'error' => 'Please enter a valid email address.'], 400);
            }
            if (strlen($password) < 6) {
                respond(['ok' => false, 'error' => 'Password must be at least 6 characters long.'], 400);
            }
            if ($avatarUrl !== '' && (!str_starts_with($avatarUrl, 'data:image/') || strlen($avatarUrl) > 600000)) {
                respond(['ok' => false, 'error' => 'Invalid or oversized avatar image.'], 400);
            }

            $existingName = $db->queryOne(
                'SELECT user_id FROM users WHERE username = :username COLLATE NOCASE',
                [':username' => $username]
            );
            if ($existingName) {
                respond(['ok' => false, 'error' => 'That username is already taken.'], 409);
            }

            $existingEmail = $db->queryOne(
                'SELECT user_id FROM users WHERE email = :email COLLATE NOCASE',
                [':email' => $email]
            );
            if ($existingEmail) {
                respond(['ok' => false, 'error' => 'An account with that email address already exists.'], 409);
            }

            $userId = 'u_' . bin2hex(random_bytes(6));
            $avatarColor = pickDefaultColor($username);
            $passwordHash = password_hash($password, PASSWORD_DEFAULT);

            // Make first registered user the instance administrator
            $userCount = $db->queryOne('SELECT COUNT(*) AS cnt FROM users');
            $isAdmin = (!$userCount || (int)$userCount['cnt'] === 0) ? 1 : 0;

            $db->execute(
                'INSERT INTO users (user_id, username, email, password_hash, avatar_url, avatar_color, auth_token, current_room, last_seen, created_at, is_admin, is_banned, ban_reason)
                 VALUES (:uid, :username, :email, :phash, :avatar_url, :avatar_color, "", "", :now, :now, :is_admin, 0, "")',
                [
                    ':uid' => $userId,
                    ':username' => $username,
                    ':email' => $email,
                    ':phash' => $passwordHash,
                    ':avatar_url' => $avatarUrl,
                    ':avatar_color' => $avatarColor,
                    ':now' => $now,
                    ':is_admin' => $isAdmin,
                ]
            );

            $authToken = createUserSession($db, $userId, $input);
            $user = $db->queryOne('SELECT * FROM users WHERE user_id = :uid', [':uid' => $userId]);

            respond([
                'ok' => true,
                'authToken' => $authToken,
                'user' => formatUserPublic($user),
            ]);
        }

        case 'login': {
            $identifier = trim((string)($input['identifier'] ?? ''));
            $password = (string)($input['password'] ?? '');

            if ($identifier === '' || $password === '') {
                respond(['ok' => false, 'error' => 'Please enter your username/email and password.'], 400);
            }

            $user = $db->queryOne(
                'SELECT * FROM users WHERE username = :id COLLATE NOCASE OR email = :id COLLATE NOCASE',
                [':id' => $identifier]
            );

            if (!$user || !password_verify($password, (string)$user['password_hash'])) {
                respond(['ok' => false, 'error' => 'Invalid username/email or password.'], 401);
            }

            if (!empty($user['is_banned'])) {
                $reason = !empty($user['ban_reason']) ? (': ' . $user['ban_reason']) : '.';
                respond(['ok' => false, 'error' => 'Your account has been banned' . $reason, 'code' => 'BANNED'], 403);
            }

            $authToken = createUserSession($db, (string)$user['user_id'], $input);

            respond([
                'ok' => true,
                'authToken' => $authToken,
                'user' => formatUserPublic($user),
            ]);
        }

        case 'logout': {
            $user = requireAuthenticatedUser($db, $input);
            $allDevices = !empty($input['all_devices']);
            $token = trim((string)($input['auth_token'] ?? $_GET['auth_token'] ?? ''));
            $tokenHash = hash('sha256', $token);
            $peerId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($input['peer_id'] ?? ''));

            if ($allDevices) {
                // Invalidate all active sessions for this user across all devices
                $db->execute('DELETE FROM user_sessions WHERE user_id = :uid', [':uid' => $user['user_id']]);
                $db->execute('UPDATE users SET auth_token = "", current_room = "" WHERE user_id = :uid', [':uid' => $user['user_id']]);
                $db->execute('DELETE FROM participants WHERE user_id = :uid', [':uid' => $user['user_id']]);
            } else {
                // Invalidate only the current session token
                $db->execute('DELETE FROM user_sessions WHERE token_hash = :hash', [':hash' => $tokenHash]);
                if ($peerId !== '') {
                    $db->execute('DELETE FROM participants WHERE peer_id = :peer_id', [':peer_id' => $peerId]);
                    $db->execute('DELETE FROM signals WHERE sender_id = :peer_id OR target_id = :peer_id', [':peer_id' => $peerId]);
                }
            }

            respond(['ok' => true]);
        }

        case 'update_profile': {
            $user = requireAuthenticatedUser($db, $input);
            $avatarUrl = (string)($input['avatar_url'] ?? $user['avatar_url']);

            if ($avatarUrl !== '' && (!str_starts_with($avatarUrl, 'data:image/') || strlen($avatarUrl) > 600000)) {
                respond(['ok' => false, 'error' => 'Invalid or oversized avatar image.'], 400);
            }

            $db->execute(
                'UPDATE users SET avatar_url = :avatar_url WHERE user_id = :uid',
                [':avatar_url' => $avatarUrl, ':uid' => $user['user_id']]
            );
            $db->execute(
                'UPDATE participants SET avatar_url = :avatar_url WHERE user_id = :uid',
                [':avatar_url' => $avatarUrl, ':uid' => $user['user_id']]
            );

            $updated = $db->queryOne('SELECT * FROM users WHERE user_id = :uid', [':uid' => $user['user_id']]);
            respond([
                'ok' => true,
                'user' => formatUserPublic($updated),
            ]);
        }

        // ======================= ADMIN ACTIONS =======================
        case 'admin_list_users': {
            $admin = requireAdminUser($db, $input);
            $onlineThreshold = $now - USER_ONLINE_TIMEOUT_SECONDS;

            $users = $db->queryAll(
                'SELECT u.user_id, u.username, u.email, u.avatar_url, u.avatar_color, u.current_room, u.last_seen, u.created_at, u.is_admin, u.is_banned, u.ban_reason,
                        (SELECT COUNT(*) FROM user_sessions s WHERE s.user_id = u.user_id AND s.expires_at > :now) AS session_count
                 FROM users u
                 ORDER BY u.is_admin DESC, (u.last_seen >= :thresh) DESC, u.username COLLATE NOCASE ASC',
                [':now' => $now, ':thresh' => $onlineThreshold]
            );

            $formatted = array_map(static function (array $u) use ($onlineThreshold): array {
                $lastSeen = (int)$u['last_seen'];
                return [
                    'userId' => (string)$u['user_id'],
                    'username' => (string)$u['username'],
                    'email' => (string)$u['email'],
                    'avatarUrl' => (string)$u['avatar_url'],
                    'avatarColor' => (string)$u['avatar_color'],
                    'currentRoom' => (string)$u['current_room'],
                    'lastSeen' => $lastSeen,
                    'isOnline' => $lastSeen >= $onlineThreshold,
                    'createdAt' => (int)$u['created_at'],
                    'isAdmin' => !empty($u['is_admin']),
                    'isBanned' => !empty($u['is_banned']),
                    'banReason' => (string)$u['ban_reason'],
                    'sessionCount' => (int)$u['session_count'],
                ];
            }, $users);

            respond([
                'ok' => true,
                'users' => $formatted,
            ]);
        }

        case 'admin_rename_user': {
            $admin = requireAdminUser($db, $input);
            $targetUserId = trim((string)($input['target_user_id'] ?? ''));
            $newUsername = sanitizeUsername((string)($input['new_username'] ?? ''));

            if ($targetUserId === '') {
                respond(['ok' => false, 'error' => 'Missing target user ID.'], 400);
            }
            if (safeStrlen($newUsername) < 2) {
                respond(['ok' => false, 'error' => 'Username must be at least 2 characters long.'], 400);
            }
            if (!preg_match('/^[a-zA-Z0-9_.\- ]+$/', $newUsername)) {
                respond(['ok' => false, 'error' => 'Username may only contain letters, numbers, spaces, dots, hyphens, and underscores.'], 400);
            }

            $target = $db->queryOne('SELECT * FROM users WHERE user_id = :uid', [':uid' => $targetUserId]);
            if (!$target) {
                respond(['ok' => false, 'error' => 'Target user not found.'], 404);
            }

            $collision = $db->queryOne(
                'SELECT user_id FROM users WHERE username = :name COLLATE NOCASE AND user_id != :uid',
                [':name' => $newUsername, ':uid' => $targetUserId]
            );
            if ($collision) {
                respond(['ok' => false, 'error' => 'That username is already taken by another account.'], 409);
            }

            $db->execute('UPDATE users SET username = :name WHERE user_id = :uid', [
                ':name' => $newUsername,
                ':uid' => $targetUserId,
            ]);
            $db->execute('UPDATE participants SET username = :name WHERE user_id = :uid', [
                ':name' => $newUsername,
                ':uid' => $targetUserId,
            ]);
            $db->execute('UPDATE messages SET username = :name WHERE user_id = :uid', [
                ':name' => $newUsername,
                ':uid' => $targetUserId,
            ]);
            $db->execute('UPDATE call_invites SET sender_name = :name WHERE sender_id = :uid', [
                ':name' => $newUsername,
                ':uid' => $targetUserId,
            ]);

            $updated = $db->queryOne('SELECT * FROM users WHERE user_id = :uid', [':uid' => $targetUserId]);
            respond([
                'ok' => true,
                'user' => formatUserPublic($updated),
            ]);
        }

        case 'admin_ban_user': {
            $admin = requireAdminUser($db, $input);
            $targetUserId = trim((string)($input['target_user_id'] ?? ''));
            $banned = !empty($input['banned']);
            $reason = trim((string)($input['reason'] ?? ''));

            if ($targetUserId === '') {
                respond(['ok' => false, 'error' => 'Missing target user ID.'], 400);
            }
            if ($targetUserId === (string)$admin['user_id']) {
                respond(['ok' => false, 'error' => 'You cannot ban your own administrator account.'], 400);
            }

            $target = $db->queryOne('SELECT * FROM users WHERE user_id = :uid', [':uid' => $targetUserId]);
            if (!$target) {
                respond(['ok' => false, 'error' => 'Target user not found.'], 404);
            }

            if ($banned) {
                $db->execute(
                    'UPDATE users SET is_banned = 1, ban_reason = :reason, current_room = "" WHERE user_id = :uid',
                    [':reason' => $reason, ':uid' => $targetUserId]
                );
                $db->execute('DELETE FROM user_sessions WHERE user_id = :uid', [':uid' => $targetUserId]);
                $db->execute('DELETE FROM participants WHERE user_id = :uid', [':uid' => $targetUserId]);
                $db->execute('DELETE FROM signals WHERE sender_id = :uid OR target_id = :uid', [':uid' => $targetUserId]);
            } else {
                $db->execute(
                    'UPDATE users SET is_banned = 0, ban_reason = "" WHERE user_id = :uid',
                    [':uid' => $targetUserId]
                );
            }

            $updated = $db->queryOne('SELECT * FROM users WHERE user_id = :uid', [':uid' => $targetUserId]);
            respond([
                'ok' => true,
                'userId' => $targetUserId,
                'isBanned' => $banned,
                'banReason' => $banned ? $reason : '',
                'user' => formatUserPublic($updated),
            ]);
        }

        case 'admin_delete_user': {
            $admin = requireAdminUser($db, $input);
            $targetUserId = trim((string)($input['target_user_id'] ?? ''));

            if ($targetUserId === '') {
                respond(['ok' => false, 'error' => 'Missing target user ID.'], 400);
            }
            if ($targetUserId === (string)$admin['user_id']) {
                respond(['ok' => false, 'error' => 'You cannot delete your own administrator account.'], 400);
            }

            $target = $db->queryOne('SELECT * FROM users WHERE user_id = :uid', [':uid' => $targetUserId]);
            if (!$target) {
                respond(['ok' => false, 'error' => 'Target user not found.'], 404);
            }

            $db->execute('DELETE FROM users WHERE user_id = :uid', [':uid' => $targetUserId]);
            $db->execute('DELETE FROM user_sessions WHERE user_id = :uid', [':uid' => $targetUserId]);
            $db->execute('DELETE FROM participants WHERE user_id = :uid', [':uid' => $targetUserId]);
            $db->execute('DELETE FROM contacts WHERE owner_id = :uid OR friend_id = :uid', [':uid' => $targetUserId]);
            $db->execute('DELETE FROM call_invites WHERE sender_id = :uid OR target_id = :uid', [':uid' => $targetUserId]);
            $db->execute('DELETE FROM messages WHERE user_id = :uid', [':uid' => $targetUserId]);
            $db->execute('DELETE FROM signals WHERE sender_id = :uid OR target_id = :uid', [':uid' => $targetUserId]);

            respond([
                'ok' => true,
                'userId' => $targetUserId,
                'username' => $target['username'],
            ]);
        }

        case 'admin_toggle_role': {
            $admin = requireAdminUser($db, $input);
            $targetUserId = trim((string)($input['target_user_id'] ?? ''));
            $makeAdmin = !empty($input['is_admin']);

            if ($targetUserId === '') {
                respond(['ok' => false, 'error' => 'Missing target user ID.'], 400);
            }

            if ($targetUserId === (string)$admin['user_id'] && !$makeAdmin) {
                $totalAdmins = $db->queryOne('SELECT COUNT(*) AS cnt FROM users WHERE is_admin = 1');
                if ((int)($totalAdmins['cnt'] ?? 0) <= 1) {
                    respond(['ok' => false, 'error' => 'Cannot remove the last administrator.'], 400);
                }
            }

            $target = $db->queryOne('SELECT * FROM users WHERE user_id = :uid', [':uid' => $targetUserId]);
            if (!$target) {
                respond(['ok' => false, 'error' => 'Target user not found.'], 404);
            }

            $db->execute('UPDATE users SET is_admin = :role WHERE user_id = :uid', [
                ':role' => $makeAdmin ? 1 : 0,
                ':uid' => $targetUserId,
            ]);

            $updated = $db->queryOne('SELECT * FROM users WHERE user_id = :uid', [':uid' => $targetUserId]);
            respond([
                'ok' => true,
                'userId' => $targetUserId,
                'isAdmin' => $makeAdmin,
                'user' => formatUserPublic($updated),
            ]);
        }

        case 'admin_list_chats': {
            $admin = requireAdminUser($db, $input);

            // 1. Channels
            $channels = $db->queryAll('SELECT channel_id, name, created_by, created_at FROM channels ORDER BY created_at ASC');
            $rooms = [];

            foreach ($channels as $ch) {
                $cid = (string)$ch['channel_id'];
                $stats = $db->queryOne(
                    'SELECT COUNT(*) as msg_count, 
                            COALESCE(SUM(LENGTH(content) + 128), 0) as total_bytes, 
                            MAX(created_at) as last_activity 
                     FROM messages WHERE room_id = :rid',
                    [':rid' => $cid]
                );
                $rooms[] = [
                    'roomId' => $cid,
                    'name' => '#' . $ch['name'],
                    'type' => 'channel',
                    'isChannel' => true,
                    'messageCount' => (int)($stats['msg_count'] ?? 0),
                    'totalBytes' => (int)($stats['total_bytes'] ?? 0),
                    'lastActivity' => (int)($stats['last_activity'] ?? $ch['created_at']),
                    'canDelete' => ($cid !== 'general'),
                ];
            }

            // 2. Direct Messages (dm-*)
            $dmRooms = $db->queryAll(
                'SELECT room_id, COUNT(*) as msg_count, 
                        COALESCE(SUM(LENGTH(content) + 128), 0) as total_bytes, 
                        MAX(created_at) as last_activity 
                 FROM messages 
                 WHERE room_id LIKE "dm-%" 
                 GROUP BY room_id 
                 ORDER BY last_activity DESC'
            );

            // User map for friendly DM titles
            $allUsers = $db->queryAll('SELECT user_id, username FROM users');
            $userMap = [];
            foreach ($allUsers as $u) {
                $userMap[(string)$u['user_id']] = (string)$u['username'];
            }

            foreach ($dmRooms as $dm) {
                $rid = (string)$dm['room_id'];
                $parts = explode('-', $rid);
                $dmLabels = [];
                if (count($parts) >= 3) {
                    $u1 = $parts[1];
                    $u2 = $parts[2];
                    $name1 = $userMap[$u1] ?? $u1;
                    $name2 = $userMap[$u2] ?? $u2;
                    $dmLabels[] = "@$name1";
                    $dmLabels[] = "@$name2";
                }
                $friendlyName = !empty($dmLabels) ? implode(' & ', $dmLabels) : $rid;

                $rooms[] = [
                    'roomId' => $rid,
                    'name' => $friendlyName,
                    'type' => 'dm',
                    'isChannel' => false,
                    'messageCount' => (int)$dm['msg_count'],
                    'totalBytes' => (int)$dm['total_bytes'],
                    'lastActivity' => (int)$dm['last_activity'],
                    'canDelete' => true,
                ];
            }

            $totalMessages = 0;
            $totalBytes = 0;
            foreach ($rooms as $r) {
                $totalMessages += $r['messageCount'];
                $totalBytes += $r['totalBytes'];
            }

            respond([
                'ok' => true,
                'chats' => $rooms,
                'totalChats' => count($rooms),
                'totalMessages' => $totalMessages,
                'totalBytes' => $totalBytes,
            ]);
        }

        case 'admin_delete_chat': {
            $admin = requireAdminUser($db, $input);
            $roomId = sanitizeRoomId((string)($input['room_id'] ?? ''));
            if ($roomId === '') {
                respond(['ok' => false, 'error' => 'Missing room ID.'], 400);
            }

            // Remove associated image files from disk
            $images = $db->queryAll('SELECT content FROM messages WHERE room_id = :rid AND type = "image"', [':rid' => $roomId]);
            foreach ($images as $img) {
                $filePath = __DIR__ . '/' . ltrim((string)$img['content'], '/\\');
                if (is_file($filePath)) {
                    @unlink($filePath);
                }
            }

            // Delete messages
            $db->execute('DELETE FROM messages WHERE room_id = :rid', [':rid' => $roomId]);

            // If custom channel (not 'general' and not DM), remove channel entry & update users
            if ($roomId !== 'general' && !str_starts_with($roomId, 'dm-')) {
                $db->execute('DELETE FROM channels WHERE channel_id = :cid', [':cid' => $roomId]);
                $db->execute('DELETE FROM participants WHERE room_id = :cid', [':cid' => $roomId]);
                $db->execute('DELETE FROM signals WHERE room_id = :cid', [':cid' => $roomId]);
                $db->execute('UPDATE users SET current_room = "general" WHERE current_room = :cid', [':cid' => $roomId]);
            }

            respond([
                'ok' => true,
                'roomId' => $roomId,
            ]);
        }

        case 'admin_list_uploads': {
            $admin = requireAdminUser($db, $input);
            $uploadDir = __DIR__ . '/uploads';
            $twoWeeksAgo = $now - (14 * 86400); // 14 days = 2 weeks

            $imageMsgs = $db->queryAll(
                'SELECT m.id, m.room_id, m.user_id, m.username, m.type, m.content, m.created_at, u.username as current_username 
                 FROM messages m 
                 LEFT JOIN users u ON m.user_id = u.user_id 
                 WHERE m.type IN ("image", "file") 
                 ORDER BY m.created_at DESC'
            );

            $uploads = [];
            $totalBytes = 0;
            $olderThan2WeeksCount = 0;
            $olderThan2WeeksBytes = 0;
            $seenFiles = [];

            foreach ($imageMsgs as $msg) {
                $raw = (string)$msg['content'];
                $relPath = $raw;
                $origName = '';
                if (str_starts_with($raw, '{')) {
                    $parsed = json_decode($raw, true);
                    if (!empty($parsed['url'])) $relPath = (string)$parsed['url'];
                    if (!empty($parsed['name'])) $origName = (string)$parsed['name'];
                }

                $filePath = __DIR__ . '/' . ltrim($relPath, '/\\');
                $filename = basename($relPath);
                $seenFiles[$filename] = true;

                $size = is_file($filePath) ? filesize($filePath) : 0;
                $totalBytes += $size;
                $isOlder = ($msg['created_at'] < $twoWeeksAgo);
                if ($isOlder) {
                    $olderThan2WeeksCount++;
                    $olderThan2WeeksBytes += $size;
                }

                $uploads[] = [
                    'id' => (int)$msg['id'],
                    'filename' => $filename,
                    'displayName' => $origName ?: $filename,
                    'type' => (string)$msg['type'],
                    'url' => $relPath,
                    'roomId' => (string)$msg['room_id'],
                    'username' => (string)($msg['current_username'] ?? $msg['username']),
                    'createdAt' => (int)$msg['created_at'],
                    'sizeBytes' => $size,
                    'isOlderThan2Weeks' => $isOlder,
                    'fileExists' => is_file($filePath),
                ];
            }

            // Scan directory for any orphan image files
            if (is_dir($uploadDir)) {
                $files = glob($uploadDir . '/*');
                if (is_array($files)) {
                    foreach ($files as $f) {
                        if (!is_file($f) || basename($f) === '.gitkeep') continue;
                        $fn = basename($f);
                        if (isset($seenFiles[$fn])) continue;

                        $size = filesize($f);
                        $mtime = filemtime($f);
                        $totalBytes += $size;
                        $isOlder = ($mtime < $twoWeeksAgo);
                        if ($isOlder) {
                            $olderThan2WeeksCount++;
                            $olderThan2WeeksBytes += $size;
                        }

                        $uploads[] = [
                            'id' => 0,
                            'filename' => $fn,
                            'url' => 'uploads/' . $fn,
                            'roomId' => 'orphan',
                            'username' => 'Orphan / System',
                            'createdAt' => $mtime,
                            'sizeBytes' => $size,
                            'isOlderThan2Weeks' => $isOlder,
                            'fileExists' => true,
                        ];
                    }
                }
            }

            respond([
                'ok' => true,
                'uploads' => $uploads,
                'totalCount' => count($uploads),
                'totalBytes' => $totalBytes,
                'olderThan2WeeksCount' => $olderThan2WeeksCount,
                'olderThan2WeeksBytes' => $olderThan2WeeksBytes,
            ]);
        }

        case 'admin_delete_upload': {
            $admin = requireAdminUser($db, $input);
            $filename = basename((string)($input['filename'] ?? ''));
            if ($filename === '' || $filename === '.gitkeep') {
                respond(['ok' => false, 'error' => 'Invalid filename.'], 400);
            }

            $filePath = __DIR__ . '/uploads/' . $filename;
            if (is_file($filePath)) {
                @unlink($filePath);
            }

            // Remove database reference
            $db->execute(
                'DELETE FROM messages WHERE type IN ("image", "file") AND (content LIKE :c1 OR content = :c2)',
                [
                    ':c1' => '%' . $filename . '%',
                    ':c2' => $filename,
                ]
            );

            respond([
                'ok' => true,
                'filename' => $filename,
            ]);
        }

        case 'admin_prune_uploads': {
            $admin = requireAdminUser($db, $input);
            $twoWeeksAgo = $now - (14 * 86400); // 14 days
            $uploadDir = __DIR__ . '/uploads';

            $deletedFiles = 0;
            $freedBytes = 0;

            // 1. Prune DB messages older than 2 weeks
            $staleMsgs = $db->queryAll(
                'SELECT id, type, content FROM messages WHERE type IN ("image", "file") AND created_at < :cutoff',
                [':cutoff' => $twoWeeksAgo]
            );
            foreach ($staleMsgs as $item) {
                $raw = (string)$item['content'];
                $relPath = $raw;
                if (str_starts_with($raw, '{')) {
                    $parsed = json_decode($raw, true);
                    if (!empty($parsed['url'])) $relPath = (string)$parsed['url'];
                }
                $filePath = __DIR__ . '/' . ltrim($relPath, '/\\');
                if (is_file($filePath)) {
                    $freedBytes += filesize($filePath);
                    @unlink($filePath);
                    $deletedFiles++;
                }
            }
            $db->execute('DELETE FROM messages WHERE type IN ("image", "file") AND created_at < :cutoff', [':cutoff' => $twoWeeksAgo]);

            // 2. Prune orphan files older than 2 weeks
            if (is_dir($uploadDir)) {
                $files = glob($uploadDir . '/*');
                if (is_array($files)) {
                    foreach ($files as $f) {
                        if (is_file($f) && basename($f) !== '.gitkeep' && filemtime($f) < $twoWeeksAgo) {
                            $freedBytes += filesize($f);
                            @unlink($f);
                            $deletedFiles++;
                        }
                    }
                }
            }

            respond([
                'ok' => true,
                'deletedCount' => $deletedFiles,
                'freedBytes' => $freedBytes,
            ]);
        }

        // ======================= WORKSPACE STATE & CHANNELS =======================
        case 'bootstrap': {
            $user = requireAuthenticatedUser($db, $input);
            cleanupStaleData($db);

            $channels = getAllChannelsWithVoicePeers($db);
            $activeRoomId = sanitizeRoomId((string)($input['active_room_id'] ?? ($channels[0]['channelId'] ?? 'general')));
            $messages = getRecentMessages($db, $activeRoomId, 80);

            respond([
                'ok' => true,
                'activeRoomId' => $textRoomId,
                'user' => formatUserPublic($user),
                'channels' => $channels,
                'contacts' => getContactsForUser($db, (string)$user['user_id']),
                'members' => getAllMembers($db, (string)$user['user_id']),
                'invites' => getPendingIncomingInvites($db, (string)$user['user_id']),
                'outgoingInvite' => getOutgoingInviteStatus($db, (string)$user['user_id']),
                'activeRoomId' => $activeRoomId,
                'messages' => $messages,
            ]);
        }

        case 'create_channel': {
            $user = requireAuthenticatedUser($db, $input);
            $name = sanitizeChannelName((string)($input['name'] ?? ''));

            if (safeStrlen($name) < 2) {
                respond(['ok' => false, 'error' => 'Channel name must be at least 2 characters long.'], 400);
            }

            if (str_starts_with($name, 'dm-')) {
                respond(['ok' => false, 'error' => 'Channel name cannot start with "dm-".'], 400);
            }

            $existing = $db->queryOne(
                'SELECT channel_id FROM channels WHERE channel_id = :cid OR name = :name COLLATE NOCASE',
                [':cid' => $name, ':name' => $name]
            );
            if ($existing) {
                respond(['ok' => false, 'error' => 'A channel with that name already exists.'], 409);
            }

            $db->execute(
                'INSERT INTO channels (channel_id, name, created_by, created_at) VALUES (:cid, :name, :by, :at)',
                [
                    ':cid' => $name,
                    ':name' => $name,
                    ':by' => $user['user_id'],
                    ':at' => $now,
                ]
            );

            respond([
                'ok' => true,
                'channelId' => $name,
                'channels' => getAllChannelsWithVoicePeers($db),
            ]);
        }

        case 'delete_channel': {
            $user = requireAuthenticatedUser($db, $input);
            $channelId = sanitizeChannelName((string)($input['channel_id'] ?? ''));

            $countRow = $db->queryOne('SELECT COUNT(*) AS cnt FROM channels');
            if ($countRow && (int)$countRow['cnt'] <= 1) {
                respond(['ok' => false, 'error' => 'You must keep at least one channel.'], 400);
            }

            // Find surviving fallback channel
            $fallback = $db->queryOne('SELECT channel_id FROM channels WHERE channel_id != :cid ORDER BY created_at ASC LIMIT 1', [':cid' => $channelId]);
            $fallbackId = $fallback ? (string)$fallback['channel_id'] : 'general';

            // Clean up any uploaded files from this channel
            $images = $db->queryAll('SELECT content FROM messages WHERE room_id = :cid AND type = "image"', [':cid' => $channelId]);
            foreach ($images as $img) {
                $filePath = __DIR__ . '/' . ltrim((string)$img['content'], '/\\');
                if (is_file($filePath)) {
                    @unlink($filePath);
                }
            }

            $db->execute('DELETE FROM channels WHERE channel_id = :cid', [':cid' => $channelId]);
            $db->execute('DELETE FROM messages WHERE room_id = :cid', [':cid' => $channelId]);
            $db->execute('DELETE FROM participants WHERE room_id = :cid', [':cid' => $channelId]);
            $db->execute('DELETE FROM signals WHERE room_id = :cid', [':cid' => $channelId]);
            $db->execute('UPDATE users SET current_room = :fallback WHERE current_room = :cid', [
                ':fallback' => $fallbackId,
                ':cid' => $channelId,
            ]);

            respond([
                'ok' => true,
                'fallbackChannelId' => $fallbackId,
                'channels' => getAllChannelsWithVoicePeers($db),
            ]);
        }

        // ======================= CONTACTS & INVITES =======================
        case 'add_contact': {
            $user = requireAuthenticatedUser($db, $input);
            $friendQuery = trim((string)($input['friend_username'] ?? ''));

            if ($friendQuery === '') {
                respond(['ok' => false, 'error' => 'Please enter a username or email to add.'], 400);
            }

            $friend = $db->queryOne(
                'SELECT user_id, username FROM users WHERE username = :q COLLATE NOCASE OR email = :q COLLATE NOCASE',
                [':q' => $friendQuery]
            );

            if (!$friend) {
                respond(['ok' => false, 'error' => sprintf('No registered user found with username "%s".', $friendQuery)], 404);
            }

            if ((string)$friend['user_id'] === (string)$user['user_id']) {
                respond(['ok' => false, 'error' => 'You cannot add yourself as a contact.'], 400);
            }

            // Mutual contact link
            $db->execute(
                'INSERT OR IGNORE INTO contacts (owner_id, friend_id, created_at) VALUES (:owner_id, :friend_id, :created_at)',
                [':owner_id' => $user['user_id'], ':friend_id' => $friend['user_id'], ':created_at' => $now]
            );
            $db->execute(
                'INSERT OR IGNORE INTO contacts (owner_id, friend_id, created_at) VALUES (:owner_id, :friend_id, :created_at)',
                [':owner_id' => $friend['user_id'], ':friend_id' => $user['user_id'], ':created_at' => $now]
            );

            respond([
                'ok' => true,
                'friendName' => $friend['username'],
                'contacts' => getContactsForUser($db, (string)$user['user_id']),
            ]);
        }

        case 'remove_contact': {
            $user = requireAuthenticatedUser($db, $input);
            $friendId = (string)($input['friend_id'] ?? '');

            if ($friendId !== '') {
                $db->execute(
                    'DELETE FROM contacts WHERE (owner_id = :uid AND friend_id = :fid) OR (owner_id = :fid AND friend_id = :uid)',
                    [':uid' => $user['user_id'], ':fid' => $friendId]
                );
            }

            respond([
                'ok' => true,
                'contacts' => getContactsForUser($db, (string)$user['user_id']),
            ]);
        }

        case 'send_invite': {
            $user = requireAuthenticatedUser($db, $input);
            $targetUserId = (string)($input['target_user_id'] ?? '');
            $mode = in_array($input['mode'] ?? 'video', ['video', 'voice', 'text'], true)
                ? (string)$input['mode']
                : 'video';

            $target = $db->queryOne('SELECT user_id, username, status FROM users WHERE user_id = :uid', [':uid' => $targetUserId]);
            if (!$target) {
                respond(['ok' => false, 'error' => 'Contact not found.'], 404);
            }

            if (!empty($input['room_id'])) {
                $roomId = sanitizeRoomId((string)$input['room_id']);
                $roomLabel = (string)($input['room_label'] ?? ('#' . $roomId));
            } else {
                $pair = [(string)$user['user_id'], (string)$target['user_id']];
                sort($pair);
                $roomId = 'dm-' . $pair[0] . '-' . $pair[1];
                $roomLabel = 'Direct Call with ' . $user['username'];
            }

            // Remove any pending invites between this pair first
            $db->execute('DELETE FROM call_invites WHERE (sender_id = :s AND target_id = :t) OR (sender_id = :t AND target_id = :s)', [
                ':s' => $user['user_id'],
                ':t' => $target['user_id'],
            ]);

            $inviteId = $db->execute(
                'INSERT INTO call_invites (sender_id, sender_name, sender_color, sender_avatar, target_id, room_id, room_label, mode, status, created_at)
                 VALUES (:sender_id, :sender_name, :sender_color, :sender_avatar, :target_id, :room_id, :room_label, :mode, "pending", :created_at)',
                [
                    ':sender_id' => $user['user_id'],
                    ':sender_name' => $user['username'],
                    ':sender_color' => $user['avatar_color'],
                    ':sender_avatar' => $user['avatar_url'],
                    ':target_id' => $target['user_id'],
                    ':room_id' => $roomId,
                    ':room_label' => $roomLabel,
                    ':mode' => $mode,
                    ':created_at' => $now,
                ]
            );

            respond([
                'ok' => true,
                'inviteId' => $inviteId,
                'roomId' => $roomId,
                'targetUserId' => $target['user_id'],
                'targetUsername' => $target['username'],
                'targetStatus' => (string)($target['status'] ?? 'online'),
            ]);
        }

        case 'respond_invite': {
            $user = requireAuthenticatedUser($db, $input);
            $inviteId = (int)($input['invite_id'] ?? 0);
            $action = (string)($input['action'] ?? ''); // 'accept', 'decline', 'cancel'

            if ($inviteId <= 0 || !in_array($action, ['accept', 'decline', 'cancel'], true)) {
                respond(['ok' => false, 'error' => 'Invalid action or invite ID.'], 400);
            }

            $invite = $db->queryOne('SELECT * FROM call_invites WHERE id = :id', [':id' => $inviteId]);
            if (!$invite) {
                respond(['ok' => false, 'error' => 'Call invite not found or expired.'], 404);
            }

            if ($action === 'accept') {
                if ($invite['target_id'] !== $user['user_id']) {
                    respond(['ok' => false, 'error' => 'Unauthorized.'], 403);
                }
                $db->execute('UPDATE call_invites SET status = "accepted", accepted_at = :now WHERE id = :id', [
                    ':now' => $now,
                    ':id' => $inviteId,
                ]);
            } elseif ($action === 'decline') {
                if ($invite['target_id'] !== $user['user_id']) {
                    respond(['ok' => false, 'error' => 'Unauthorized.'], 403);
                }
                $db->execute('UPDATE call_invites SET status = "declined" WHERE id = :id', [
                    ':id' => $inviteId,
                ]);
            } elseif ($action === 'cancel') {
                if ($invite['sender_id'] !== $user['user_id']) {
                    respond(['ok' => false, 'error' => 'Unauthorized.'], 403);
                }
                $db->execute('UPDATE call_invites SET status = "cancelled" WHERE id = :id', [
                    ':id' => $inviteId,
                ]);
            }

            respond([
                'ok' => true,
                'inviteId' => $inviteId,
                'status' => $action === 'accept' ? 'accepted' : ($action === 'decline' ? 'declined' : 'cancelled'),
                'roomId' => $invite['room_id'],
                'mode' => $invite['mode'],
            ]);
        }

        case 'set_status': {
            $user = requireAuthenticatedUser($db, $input);
            $status = (string)($input['status'] ?? 'online');
            if (!in_array($status, ['online', 'away', 'dnd'], true)) {
                $status = 'online';
            }

            $db->execute('UPDATE users SET status = :status, last_seen = :now WHERE user_id = :uid', [
                ':status' => $status,
                ':now' => $now,
                ':uid' => $user['user_id'],
            ]);

            respond([
                'ok' => true,
                'status' => $status,
            ]);
        }

        // ======================= CHAT & VOICE/VIDEO ROOMS =======================
        case 'switch_text_room': {
            $user = requireAuthenticatedUser($db, $input);
            $roomId = sanitizeRoomId((string)($input['room_id'] ?? 'general'));
            if (!str_starts_with($roomId, 'dm-')) {
                $chExists = $db->queryOne('SELECT channel_id FROM channels WHERE channel_id = :cid', [':cid' => $roomId]);
                if (!$chExists) {
                    $firstCh = $db->queryOne('SELECT channel_id FROM channels ORDER BY created_at ASC LIMIT 1');
                    $roomId = $firstCh ? (string)$firstCh['channel_id'] : 'general';
                }
            }
            $messages = getRecentMessages($db, $roomId, 80);

            respond([
                'ok' => true,
                'roomId' => $roomId,
                'messages' => $messages,
            ]);
        }

        case 'join_call': {
            $user = requireAuthenticatedUser($db, $input);
            $roomId = sanitizeRoomId((string)($input['room_id'] ?? 'general'));
            $peerId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($input['peer_id'] ?? '')) ?: ('p_' . bin2hex(random_bytes(8)));
            $micEnabled = !empty($input['mic_enabled']) ? 1 : 0;
            $camEnabled = !empty($input['cam_enabled']) ? 1 : 0;
            $screenSharing = !empty($input['screen_sharing']) ? 1 : 0;

            cleanupStaleData($db);

            // Remove this user from any previous voice/video room first
            $db->execute('DELETE FROM participants WHERE user_id = :uid AND peer_id != :pid', [
                ':uid' => $user['user_id'],
                ':pid' => $peerId,
            ]);

            $existing = $db->queryOne(
                'SELECT peer_id FROM participants WHERE peer_id = :peer_id AND room_id = :room_id',
                [':peer_id' => $peerId, ':room_id' => $roomId]
            );

            $currentPeers = getRoomParticipants($db, $roomId);
            if (!$existing && count($currentPeers) >= MAX_ROOM_PARTICIPANTS) {
                respond([
                    'ok' => false,
                    'error' => sprintf('This call is full (maximum %d people allowed).', MAX_ROOM_PARTICIPANTS),
                    'code' => 'ROOM_FULL',
                ], 403);
            }

            $db->execute('DELETE FROM signals WHERE target_id = :peer_id OR sender_id = :peer_id', [':peer_id' => $peerId]);

            $db->execute(
                'INSERT OR REPLACE INTO participants
                 (peer_id, user_id, room_id, username, avatar_color, avatar_url, mic_enabled, cam_enabled, screen_sharing, joined_at, last_seen)
                 VALUES (:peer_id, :user_id, :room_id, :username, :avatar_color, :avatar_url, :mic_enabled, :cam_enabled, :screen_sharing, :joined_at, :last_seen)',
                [
                    ':peer_id' => $peerId,
                    ':user_id' => $user['user_id'],
                    ':room_id' => $roomId,
                    ':username' => $user['username'],
                    ':avatar_color' => $user['avatar_color'],
                    ':avatar_url' => $user['avatar_url'],
                    ':mic_enabled' => $micEnabled,
                    ':cam_enabled' => $camEnabled,
                    ':screen_sharing' => $screenSharing,
                    ':joined_at' => $now,
                    ':last_seen' => $now,
                ]
            );

            $db->execute('UPDATE users SET current_room = :room_id, last_seen = :now WHERE user_id = :uid', [
                ':room_id' => $roomId,
                ':now' => $now,
                ':uid' => $user['user_id'],
            ]);

            $participants = getRoomParticipants($db, $roomId);

            respond([
                'ok' => true,
                'roomId' => $roomId,
                'peerId' => $peerId,
                'participants' => $participants,
                'channels' => getAllChannelsWithVoicePeers($db),
            ]);
        }

        case 'leave_call': {
            $user = requireAuthenticatedUser($db, $input);
            $peerId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($input['peer_id'] ?? ''));

            if ($peerId !== '') {
                $db->execute('DELETE FROM participants WHERE peer_id = :peer_id', [':peer_id' => $peerId]);
                $db->execute('DELETE FROM signals WHERE sender_id = :peer_id OR target_id = :peer_id', [':peer_id' => $peerId]);
            }
            $db->execute('DELETE FROM participants WHERE user_id = :uid', [':uid' => $user['user_id']]);
            $db->execute('UPDATE users SET current_room = "", last_seen = :now WHERE user_id = :uid', [
                ':now' => $now,
                ':uid' => $user['user_id'],
            ]);

            respond([
                'ok' => true,
                'channels' => getAllChannelsWithVoicePeers($db),
            ]);
        }

        case 'sync': {
            $user = requireAuthenticatedUser($db, $input);
            if (isset($input['user_status']) && in_array($input['user_status'], ['online', 'away', 'dnd'], true)) {
                $db->execute('UPDATE users SET status = :status WHERE user_id = :uid', [
                    ':status' => (string)$input['user_status'],
                    ':uid' => $user['user_id'],
                ]);
                $user['status'] = (string)$input['user_status'];
            }
            $textRoomId = sanitizeRoomId((string)($input['text_room_id'] ?? ($input['room_id'] ?? 'general')));
            if (!str_starts_with($textRoomId, 'dm-')) {
                $chExists = $db->queryOne('SELECT channel_id FROM channels WHERE channel_id = :cid', [':cid' => $textRoomId]);
                if (!$chExists) {
                    $firstCh = $db->queryOne('SELECT channel_id FROM channels ORDER BY created_at ASC LIMIT 1');
                    $textRoomId = $firstCh ? (string)$firstCh['channel_id'] : 'general';
                }
            }
            $callRoomId = isset($input['call_room_id']) && $input['call_room_id'] !== ''
                ? sanitizeRoomId((string)$input['call_room_id'])
                : '';
            $peerId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($input['peer_id'] ?? ''));
            $lastMessageId = (int)($input['last_message_id'] ?? ($input['last_msg_id'] ?? 0));

            cleanupStaleData($db);

            $signals = [];
            $callParticipants = [];

            if ($callRoomId !== '' && $peerId !== '') {
                $existing = $db->queryOne(
                    'SELECT peer_id FROM participants WHERE peer_id = :peer_id AND room_id = :room_id',
                    [':peer_id' => $peerId, ':room_id' => $callRoomId]
                );

                if ($existing) {
                    $db->execute(
                        'UPDATE participants
                         SET last_seen = :last_seen,
                             mic_enabled = :mic_enabled,
                             cam_enabled = :cam_enabled,
                             screen_sharing = :screen_sharing,
                             avatar_url = :avatar_url
                         WHERE peer_id = :peer_id AND room_id = :room_id',
                        [
                            ':last_seen' => $now,
                            ':mic_enabled' => !empty($input['mic_enabled']) ? 1 : 0,
                            ':cam_enabled' => !empty($input['cam_enabled']) ? 1 : 0,
                            ':screen_sharing' => !empty($input['screen_sharing']) ? 1 : 0,
                            ':avatar_url' => $user['avatar_url'],
                            ':peer_id' => $peerId,
                            ':room_id' => $callRoomId,
                        ]
                    );
                } else {
                    $db->execute(
                        'INSERT OR REPLACE INTO participants
                         (peer_id, user_id, room_id, username, avatar_color, avatar_url, mic_enabled, cam_enabled, screen_sharing, joined_at, last_seen)
                         VALUES (:peer_id, :user_id, :room_id, :username, :avatar_color, :avatar_url, :mic_enabled, :cam_enabled, :screen_sharing, :joined_at, :last_seen)',
                        [
                            ':peer_id' => $peerId,
                            ':user_id' => $user['user_id'],
                            ':room_id' => $callRoomId,
                            ':username' => $user['username'],
                            ':avatar_color' => $user['avatar_color'],
                            ':avatar_url' => $user['avatar_url'],
                            ':mic_enabled' => !empty($input['mic_enabled']) ? 1 : 0,
                            ':cam_enabled' => !empty($input['cam_enabled']) ? 1 : 0,
                            ':screen_sharing' => !empty($input['screen_sharing']) ? 1 : 0,
                            ':joined_at' => $now,
                            ':last_seen' => $now,
                        ]
                    );
                }

                $signalRows = $db->queryAll(
                    'SELECT id, sender_id, type, payload, created_at
                     FROM signals
                     WHERE target_id = :target_id
                     ORDER BY id ASC',
                    [':target_id' => $peerId]
                );

                if (!empty($signalRows)) {
                    $maxSignalId = max(array_column($signalRows, 'id'));
                    $db->execute(
                        'DELETE FROM signals WHERE target_id = :target_id AND id <= :max_id',
                        [':target_id' => $peerId, ':max_id' => $maxSignalId]
                    );
                }

                $signals = array_map(static function (array $row): array {
                    return [
                        'id' => (int)$row['id'],
                        'senderId' => (string)$row['sender_id'],
                        'type' => (string)$row['type'],
                        'payload' => json_decode((string)$row['payload'], true),
                        'createdAt' => (int)$row['created_at'],
                    ];
                }, $signalRows);

                $callParticipants = getRoomParticipants($db, $callRoomId);
            }

            $newMessages = $db->queryAll(
                'SELECT id, room_id, peer_id, user_id, username, avatar_color, avatar_url, type, content, created_at, edited_at
                 FROM messages
                 WHERE room_id = :room_id AND id > :last_id
                 ORDER BY id ASC
                 LIMIT 100',
                [':room_id' => $textRoomId, ':last_id' => $lastMessageId]
            );

            $editedMessages = [];
            if ($lastMessageId > 0) {
                $editedMessages = $db->queryAll(
                    'SELECT id, room_id, peer_id, user_id, username, avatar_color, avatar_url, type, content, created_at, edited_at
                     FROM messages
                     WHERE room_id = :room_id AND edited_at > :edit_cutoff AND id <= :last_id
                     ORDER BY edited_at ASC',
                    [':room_id' => $textRoomId, ':edit_cutoff' => $now - 60, ':last_id' => $lastMessageId]
                );
            }

            respond([
                'ok' => true,
                'activeRoomId' => $textRoomId,
                'user' => formatUserPublic($user),
                'channels' => getAllChannelsWithVoicePeers($db),
                'contacts' => getContactsForUser($db, (string)$user['user_id']),
                'members' => getAllMembers($db, (string)$user['user_id']),
                'invites' => getPendingIncomingInvites($db, (string)$user['user_id']),
                'outgoingInvite' => getOutgoingInviteStatus($db, (string)$user['user_id']),
                'messages' => formatMessages($newMessages),
                'editedMessages' => formatMessages($editedMessages),
                'callParticipants' => $callParticipants,
                'signals' => $signals,
            ]);
        }

        case 'signal_batch': {
            $user = requireAuthenticatedUser($db, $input);
            $roomId = sanitizeRoomId((string)($input['room_id'] ?? 'general'));
            $senderId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($input['sender_id'] ?? ''));
            $items = is_array($input['signals'] ?? null) ? $input['signals'] : [];

            if ($senderId === '' || empty($items)) {
                respond(['ok' => false, 'error' => 'Invalid signal batch'], 400);
            }

            foreach ($items as $item) {
                $targetId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($item['target_id'] ?? ''));
                $type = (string)($item['type'] ?? '');
                $payload = $item['payload'] ?? null;
                if ($targetId !== '' && $type !== '' && $payload !== null) {
                    $db->execute(
                        'INSERT INTO signals (room_id, sender_id, target_id, type, payload, created_at)
                         VALUES (:room_id, :sender_id, :target_id, :type, :payload, :created_at)',
                        [
                            ':room_id' => $roomId,
                            ':sender_id' => $senderId,
                            ':target_id' => $targetId,
                            ':type' => $type,
                            ':payload' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                            ':created_at' => $now,
                        ]
                    );
                }
            }

            respond(['ok' => true]);
        }

        case 'message': {
            $user = requireAuthenticatedUser($db, $input);
            $roomId = sanitizeRoomId((string)($input['room_id'] ?? 'general'));
            $peerId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($input['peer_id'] ?? ''));
            $content = trim((string)($input['content'] ?? ''));

            if (!str_starts_with($roomId, 'dm-')) {
                $chExists = $db->queryOne('SELECT channel_id FROM channels WHERE channel_id = :cid', [':cid' => $roomId]);
                if (!$chExists) {
                    respond(['ok' => false, 'error' => 'This channel no longer exists.', 'code' => 'CHANNEL_NOT_FOUND'], 404);
                }
            }

            if ($content === '') {
                respond(['ok' => false, 'error' => 'Message cannot be empty'], 400);
            }

            $content = safeSubstr($content, 0, 2000);

            $msgId = $db->execute(
                'INSERT INTO messages (room_id, peer_id, user_id, username, avatar_color, avatar_url, type, content, created_at)
                 VALUES (:room_id, :peer_id, :user_id, :username, :avatar_color, :avatar_url, :type, :content, :created_at)',
                [
                    ':room_id' => $roomId,
                    ':peer_id' => $peerId,
                    ':user_id' => $user['user_id'],
                    ':username' => $user['username'],
                    ':avatar_color' => $user['avatar_color'],
                    ':avatar_url' => $user['avatar_url'],
                    ':type' => 'text',
                    ':content' => $content,
                    ':created_at' => $now,
                ]
            );

            respond([
                'ok' => true,
                'message' => [
                    'id' => $msgId,
                    'roomId' => $roomId,
                    'peerId' => $peerId,
                    'userId' => (string)$user['user_id'],
                    'username' => (string)$user['username'],
                    'avatarColor' => (string)$user['avatar_color'],
                    'avatarUrl' => (string)$user['avatar_url'],
                    'type' => 'text',
                    'content' => $content,
                    'createdAt' => $now,
                    'editedAt' => 0,
                ],
            ]);
        }

        case 'edit_message': {
            $user = requireAuthenticatedUser($db, $input);
            $messageId = (int)($input['message_id'] ?? 0);
            $content = trim((string)($input['content'] ?? ''));

            if ($messageId <= 0) {
                respond(['ok' => false, 'error' => 'Invalid message ID.'], 400);
            }
            if ($content === '') {
                respond(['ok' => false, 'error' => 'Message cannot be empty.'], 400);
            }

            $content = safeSubstr($content, 0, 2000);

            $msg = $db->queryOne('SELECT * FROM messages WHERE id = :id', [':id' => $messageId]);
            if (!$msg) {
                respond(['ok' => false, 'error' => 'Message not found.'], 404);
            }

            if ((string)$msg['user_id'] !== (string)$user['user_id'] && empty($user['is_admin'])) {
                respond(['ok' => false, 'error' => 'You can only edit your own messages.'], 403);
            }

            if ($msg['type'] !== 'text') {
                respond(['ok' => false, 'error' => 'Only text messages can be edited.'], 400);
            }

            $db->execute(
                'UPDATE messages SET content = :content, edited_at = :now WHERE id = :id',
                [':content' => $content, ':now' => $now, ':id' => $messageId]
            );

            $updated = $db->queryOne('SELECT * FROM messages WHERE id = :id', [':id' => $messageId]);
            respond([
                'ok' => true,
                'message' => formatMessages([$updated])[0],
            ]);
        }

        case 'url_preview': {
            $user = requireAuthenticatedUser($db, $input);
            $rawUrl = trim((string)($input['url'] ?? ($_GET['url'] ?? '')));
            if (!filter_var($rawUrl, FILTER_VALIDATE_URL)) {
                respond(['ok' => false, 'error' => 'Invalid URL'], 400);
            }

            $parsed = parse_url($rawUrl);
            $scheme = strtolower($parsed['scheme'] ?? '');
            if ($scheme !== 'http' && $scheme !== 'https') {
                respond(['ok' => false, 'error' => 'Unsupported URL scheme'], 400);
            }

            $host = strtolower($parsed['host'] ?? '');
            if ($host === '' || $host === 'localhost' || $host === '127.0.0.1' || str_ends_with($host, '.local') || str_ends_with($host, '.internal')) {
                respond(['ok' => false, 'error' => 'Private or loopback hosts not allowed'], 400);
            }

            // Prevent SSRF: resolve DNS and check for private / reserved IP ranges
            $ip = gethostbyname($host);
            if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                respond(['ok' => false, 'error' => 'Restricted host'], 403);
            }

            // Check cache table
            $cached = $db->queryOne(
                'SELECT image_url, title, description, domain, is_image FROM url_previews WHERE url = :u AND created_at > :cutoff',
                [':u' => $rawUrl, ':cutoff' => $now - 86400]
            );
            if ($cached) {
                respond([
                    'ok' => true,
                    'url' => $rawUrl,
                    'domain' => (string)$cached['domain'],
                    'title' => (string)$cached['title'],
                    'description' => (string)$cached['description'],
                    'imageUrl' => (string)$cached['image_url'],
                    'isImage' => (bool)$cached['is_image'],
                ]);
            }

            // Direct image extension check
            $path = $parsed['path'] ?? '';
            $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
            if (in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'], true)) {
                $db->execute(
                    'INSERT OR REPLACE INTO url_previews (url, image_url, title, description, domain, is_image, created_at)
                     VALUES (:url, :image_url, :title, :description, :domain, 1, :created_at)',
                    [
                        ':url' => $rawUrl,
                        ':image_url' => $rawUrl,
                        ':title' => basename($path),
                        ':description' => $host,
                        ':domain' => $host,
                        ':created_at' => $now,
                    ]
                );
                respond([
                    'ok' => true,
                    'url' => $rawUrl,
                    'domain' => $host,
                    'title' => basename($path),
                    'description' => 'Direct image',
                    'imageUrl' => $rawUrl,
                    'isImage' => true,
                ]);
            }

            // Fetch page with fast timeout (max 2.5 seconds, max 128KB)
            $ctx = stream_context_create([
                'http' => [
                    'method' => 'GET',
                    'header' => "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n" .
                                "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8\r\n",
                    'timeout' => 2.5,
                    'follow_location' => 1,
                    'max_redirects' => 3,
                    'ignore_errors' => true,
                ],
                'ssl' => [
                    'verify_peer' => false,
                    'verify_peer_name' => false,
                ]
            ]);

            $stream = @fopen($rawUrl, 'r', false, $ctx);
            $content = '';
            $metaData = [];
            if ($stream) {
                $metaData = stream_get_meta_data($stream);
                $content = (string)stream_get_contents($stream, 131072);
                fclose($stream);
            }

            $title = '';
            $desc = '';
            $imageUrl = '';
            $isImage = false;

            // Check Content-Type from headers
            $headers = $metaData['wrapper_data'] ?? [];
            $contentType = '';
            foreach ($headers as $h) {
                if (stripos($h, 'Content-Type:') === 0) {
                    $contentType = trim(substr($h, 13));
                }
            }

            if (stripos($contentType, 'image/') === 0) {
                $isImage = true;
                $imageUrl = $rawUrl;
                $title = basename($path) ?: $host;
                $desc = 'Direct image';
            } elseif ($content !== '') {
                // Parse HTML OpenGraph & Meta Tags
                if (preg_match('/<meta\s+[^>]*property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']/i', $content, $m)) {
                    $imageUrl = trim($m[1]);
                } elseif (preg_match('/<meta\s+[^>]*name=["\']twitter:image["\'][^>]*content=["\']([^"\']+)["\']/i', $content, $m)) {
                    $imageUrl = trim($m[1]);
                }

                if (preg_match('/<meta\s+[^>]*property=["\']og:title["\'][^>]*content=["\']([^"\']+)["\']/i', $content, $m)) {
                    $title = html_entity_decode(trim($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
                } elseif (preg_match('/<title[^>]*>(.*?)<\/title>/is', $content, $m)) {
                    $title = html_entity_decode(trim(strip_tags($m[1])), ENT_QUOTES | ENT_HTML5, 'UTF-8');
                }

                if (preg_match('/<meta\s+[^>]*property=["\']og:description["\'][^>]*content=["\']([^"\']+)["\']/i', $content, $m)) {
                    $desc = html_entity_decode(trim($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
                } elseif (preg_match('/<meta\s+[^>]*name=["\']description["\'][^>]*content=["\']([^"\']+)["\']/i', $content, $m)) {
                    $desc = html_entity_decode(trim($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
                }
            }

            // Resolve relative imageUrl if needed
            if ($imageUrl !== '' && !preg_match('#^https?://#i', $imageUrl)) {
                $origin = ($parsed['scheme'] ?? 'https') . '://' . ($parsed['host'] ?? '');
                if (isset($parsed['port'])) $origin .= ':' . $parsed['port'];
                if (str_starts_with($imageUrl, '/')) {
                    $imageUrl = $origin . $imageUrl;
                } else {
                    $dir = rtrim(dirname($parsed['path'] ?? '/'), '/\\');
                    $imageUrl = $origin . ($dir !== '' ? $dir : '') . '/' . $imageUrl;
                }
            }

            if ($imageUrl === '') {
                // High-resolution website screenshot preview
                $imageUrl = 'https://s.wordpress.com/mshots/v1/' . urlencode($rawUrl) . '?w=600';
            }

            if ($title === '') {
                $title = $host;
            }
            if ($desc === '') {
                $desc = $rawUrl;
            }

            $db->execute(
                'INSERT OR REPLACE INTO url_previews (url, image_url, title, description, domain, is_image, created_at)
                 VALUES (:url, :image_url, :title, :description, :domain, :is_image, :created_at)',
                [
                    ':url' => $rawUrl,
                    ':image_url' => $imageUrl,
                    ':title' => mb_substr($title, 0, 150),
                    ':description' => mb_substr($desc, 0, 250),
                    ':domain' => $host,
                    ':is_image' => $isImage ? 1 : 0,
                    ':created_at' => $now,
                ]
            );

            respond([
                'ok' => true,
                'url' => $rawUrl,
                'domain' => $host,
                'title' => mb_substr($title, 0, 150),
                'description' => mb_substr($desc, 0, 250),
                'imageUrl' => $imageUrl,
                'isImage' => $isImage,
            ]);
        }

        case 'upload_file':
        case 'upload_image': {
            $user = requireAuthenticatedUser($db, $input);
            $roomId = sanitizeRoomId((string)($_POST['room_id'] ?? ($input['room_id'] ?? 'general')));
            $peerId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($_POST['peer_id'] ?? ($input['peer_id'] ?? '')));

            if (!str_starts_with($roomId, 'dm-')) {
                $chExists = $db->queryOne('SELECT channel_id FROM channels WHERE channel_id = :cid', [':cid' => $roomId]);
                if (!$chExists) {
                    respond(['ok' => false, 'error' => 'This channel no longer exists.', 'code' => 'CHANNEL_NOT_FOUND'], 404);
                }
            }

            $fileKey = isset($_FILES['file']) ? 'file' : (isset($_FILES['image']) ? 'image' : null);
            if (!$fileKey || !isset($_FILES[$fileKey]) || $_FILES[$fileKey]['error'] !== UPLOAD_ERR_OK) {
                $errCode = $fileKey ? ($_FILES[$fileKey]['error'] ?? -1) : -1;
                if ($errCode === UPLOAD_ERR_INI_SIZE || $errCode === UPLOAD_ERR_FORM_SIZE) {
                    respond([
                        'ok' => false,
                        'error' => 'File is too large. Maximum allowed size is 128 MB.',
                        'code' => 'FILE_TOO_LARGE',
                    ], 413);
                }
                respond(['ok' => false, 'error' => 'No valid file received.'], 400);
            }

            $fileSize = (int)$_FILES[$fileKey]['size'];
            if ($fileSize > MAX_UPLOAD_BYTES) {
                respond([
                    'ok' => false,
                    'error' => sprintf('File is too large (%.1f MB). Maximum allowed size is 128 MB.', $fileSize / (1024 * 1024)),
                    'code' => 'FILE_TOO_LARGE',
                ], 413);
            }

            $tmpPath = (string)$_FILES[$fileKey]['tmp_name'];
            $origName = (string)($_FILES[$fileKey]['name'] ?? 'file');
            $cleanOrigName = preg_replace('/[^\w\s\.-]/u', '_', $origName) ?: 'file';
            $ext = strtolower(pathinfo($cleanOrigName, PATHINFO_EXTENSION));

            // Prevent executable files from running on server
            $dangerousExts = ['php', 'phtml', 'php3', 'php4', 'php5', 'php7', 'phps', 'exe', 'bat', 'cmd', 'sh', 'bash', 'cgi', 'pl', 'py'];
            $safeExt = in_array($ext, $dangerousExts, true) ? 'txt' : ($ext ?: 'bin');

            $uploadDir = __DIR__ . '/uploads';
            if (!is_dir($uploadDir)) {
                @mkdir($uploadDir, 0755, true);
            }

            $isImage = in_array($safeExt, ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'], true);
            $filename = ($isImage ? 'img_' : 'file_') . time() . '_' . bin2hex(random_bytes(8)) . '.' . $safeExt;
            $destination = $uploadDir . '/' . $filename;

            if (!move_uploaded_file($tmpPath, $destination)) {
                respond(['ok' => false, 'error' => 'Failed to save uploaded file on server.'], 500);
            }

            $fileRelPath = 'uploads/' . $filename;

            if ($isImage) {
                $msgType = 'image';
                $msgContent = $fileRelPath;
            } else {
                $msgType = 'file';
                $msgContent = json_encode([
                    'url' => $fileRelPath,
                    'name' => $cleanOrigName,
                    'size' => $fileSize,
                    'ext' => $safeExt,
                ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            }

            $msgId = $db->execute(
                'INSERT INTO messages (room_id, peer_id, user_id, username, avatar_color, avatar_url, type, content, created_at, edited_at)
                 VALUES (:room_id, :peer_id, :user_id, :username, :avatar_color, :avatar_url, :type, :content, :created_at, 0)',
                [
                    ':room_id' => $roomId,
                    ':peer_id' => $peerId,
                    ':user_id' => $user['user_id'],
                    ':username' => $user['username'],
                    ':avatar_color' => $user['avatar_color'],
                    ':avatar_url' => $user['avatar_url'],
                    ':type' => $msgType,
                    ':content' => $msgContent,
                    ':created_at' => $now,
                ]
            );

            respond([
                'ok' => true,
                'message' => [
                    'id' => (int)$msgId,
                    'roomId' => $roomId,
                    'peerId' => $peerId,
                    'userId' => (string)$user['user_id'],
                    'username' => (string)$user['username'],
                    'avatarColor' => (string)$user['avatar_color'],
                    'avatarUrl' => (string)$user['avatar_url'],
                    'type' => $msgType,
                    'content' => $msgContent,
                    'createdAt' => $now,
                    'editedAt' => 0,
                ],
            ]);
        }
                    'roomId' => $roomId,
                    'peerId' => $peerId,
                    'userId' => (string)$user['user_id'],
                    'username' => (string)$user['username'],
                    'avatarColor' => (string)$user['avatar_color'],
                    'avatarUrl' => (string)$user['avatar_url'],
                    'type' => 'image',
                    'content' => $imageRelPath,
                    'createdAt' => $now,
                    'editedAt' => 0,
                ],
            ]);
        }

        default:
            respond([
                'ok' => true,
                'maxParticipants' => MAX_ROOM_PARTICIPANTS,
                'serverTime' => $now,
            ]);
    }
} catch (Throwable $e) {
    respond([
        'ok' => false,
        'error' => $e->getMessage(),
    ], 500);
}
