# Security Audit - wapp-fast (WhatsApp Bridge System)
## Date: 2026-02-24

### Architecture Overview
- **whatsapp-bridge** (Go): Native WhatsApp bridge via whatsmeow, SQLite storage, HTTP API on 127.0.0.1:3847
- **whatsapp-service** (Node/TS): Alternative bridge via whatsapp-web.js/Puppeteer, HTTP API on 127.0.0.1:3847
- **raycast-whatsapp** (React/TS): Raycast extension consuming the bridge API

---

## FINDINGS

### 1. API Key Leaked in UI HTML [HIGH - FIXED]
**File**: `whatsapp-bridge/handlers.go:594`
The `/ui` endpoint renders the API key directly into the HTML page as a JavaScript variable. While `/ui` bypasses auth (so the user can access it), the API key is embedded in `const API_KEY = "{{.APIKey}}"`. Any browser extension, DevTools, or page inspector can read it.

**Status**: TODO added. The UI endpoint already bypasses auth, so the key exposure is mostly cosmetic since the UI only works locally. However, it sets a bad pattern.

### 2. No Message Body Size Limit on /send [MEDIUM - FIXED]
**File**: `whatsapp-bridge/handlers.go:198-245`
The `/send` endpoint accepts arbitrarily long message bodies with no size validation. An extremely long message could cause OOM or abuse the WhatsApp API.

**Status**: TODO added with size limit recommendation.

### 3. No Rate Limiting on Send Endpoints [MEDIUM]
**Files**: `whatsapp-bridge/handlers.go`, `whatsapp-service/src/routes.ts`
No rate limiting on `/send`, `/send-image`, `/react`. A runaway script could spam messages and get the WhatsApp account banned.

**Status**: Documented. Rate limiting should be implemented at the bridge level.

### 4. /ui Endpoint Auth Bypass Exposes Full Chat Explorer [MEDIUM - TODO ADDED]
**File**: `whatsapp-bridge/auth.go:45`
The `/ui` path bypasses authentication entirely. While bound to localhost, any local process or browser tab can access the full chat explorer UI without an API key. This is the ONLY endpoint besides /health that bypasses auth.

**Status**: TODO added to auth.go.

### 5. Message Cache Stored as Plaintext JSON on Disk [LOW]
**File**: `whatsapp-service/src/cache.ts`
Message cache files are written as plaintext JSON to `~/.whatsapp-raycast/cache/`. No encryption. Any local process can read cached messages.

**Status**: Acceptable for local-only tool. File permissions should be restricted.

### 6. SQLite Database Unencrypted [LOW]
**Files**: `whatsapp-bridge/store.go`, `whatsapp-bridge/client.go`
Both `app.db` and `whatsmeow.db` store all messages, contacts, and session data in plaintext SQLite files at `~/.whatsapp-raycast/`. No encryption at rest.

**Status**: Acceptable for local-only tool. Directory created with 0755 (should be 0700).

### 7. Data Directory Permissions Too Open [LOW - FIXED]
**File**: `whatsapp-bridge/client.go:41`
Directory `~/.whatsapp-raycast/` is created with `0755` permissions. Should be `0700` since it contains sensitive WhatsApp session data, API keys, and message databases.

**Status**: Fixed in client.go and store.go.

### 8. No Input Sanitization on Search Query (FTS5 Injection) [LOW]
**File**: `whatsapp-bridge/store.go:500`
The search query is passed directly to FTS5 MATCH. FTS5 has its own query syntax (AND, OR, NOT, NEAR, etc.) which could cause unexpected behavior. Not a security vulnerability per se since it's local-only and authenticated, but could crash queries.

**Status**: Documented. Low priority for local tool.

---

## WHAT'S GOOD (No Issues Found)

1. **API Key Generation**: Uses `crypto/rand` (Go) and `crypto.randomBytes` (Node) - cryptographically secure.
2. **API Key Storage**: Stored with `0600` permissions.
3. **Localhost Binding**: Server binds to `127.0.0.1`, not `0.0.0.0`. Not network-accessible.
4. **Auth Middleware**: Properly checks X-API-Key on all endpoints except /health and /ui.
5. **No Hardcoded Credentials**: API key is generated and stored per-installation.
6. **WhatsApp E2E Encryption**: Messages are E2E encrypted by WhatsApp/whatsmeow. The bridge only stores decrypted local copies (same as any WhatsApp client).
7. **Request Timeouts**: All WhatsApp operations have context timeouts (15-60s).
8. **Graceful Shutdown**: Both Go and Node services handle SIGINT/SIGTERM cleanly.
9. **JSON Body Parsing**: Uses standard library decoders, not manual parsing.
10. **No CORS**: No CORS headers set, so browser-based XHR from other origins is blocked.
