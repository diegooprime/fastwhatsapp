name: WhatsApp Raycast Extension
overview: Build a Raycast extension backed by a local Node.js service running whatsapp-web.js, enabling fast keyboard-driven WhatsApp messaging with favorite contacts, search, message sending (text/clipboard images), and conversation viewing.
todos:
  - id: service-setup
    content: Create whatsapp-service with Express + whatsapp-web.js + session persistence
    status: completed
  - id: service-endpoints
    content: "Implement REST endpoints: status, qr, contacts, messages, send, send-image"
    status: completed
  - id: launchd
    content: Create LaunchAgent plist for auto-start on Mac login
    status: completed
  - id: raycast-scaffold
    content: Scaffold Raycast extension with preferences for favorites and port
    status: completed
  - id: raycast-main
    content: Build main contacts list view with favorites + search
    status: completed
  - id: raycast-compose
    content: Build compose message form with clipboard image detection
    status: completed
  - id: raycast-convo
    content: Build conversation view showing last 10 messages
    status: completed
  - id: raycast-qr
    content: Build QR code scanning flow for first-time auth
    status: completed
---

# WhatsApp Raycast Extension

## Architecture

Two components:

1. **Background Service** (`whatsapp-service/`) - Node.js server using `whatsapp-web.js` that maintains WhatsApp Web connection and exposes a local REST API
2. **Raycast Extension** (`raycast-whatsapp/`) - TypeScript/React extension that calls the local service

```
┌─────────────────┐     HTTP localhost:3847     ┌──────────────────────┐
│ Raycast Extension│ ◄──────────────────────────► │ whatsapp-web.js      │
│ (UI + Actions)   │                             │ Background Service   │
└─────────────────┘                             └──────────────────────┘
                                                         │
                                                         ▼
                                                  WhatsApp Web
```

## 1. Background Service (`whatsapp-service/`)

**Stack:** Node.js, Express, whatsapp-web.js, TypeScript

**REST Endpoints:**
- `GET /status` - Check if authenticated
- `GET /qr` - Get QR code for initial auth (displayed in Raycast)
- `GET /contacts` - List all contacts with names/numbers
- `GET /chats/:chatId/messages?limit=10` - Get recent messages
- `POST /send` - Send text message `{ chatId, message }`
- `POST /send-image` - Send image from base64 `{ chatId, base64, caption? }`

**Session persistence:** Stored in `~/.whatsapp-raycast/session/` so you don't re-scan QR on restart.

**LaunchAgent:** `~/Library/LaunchAgents/com.whatsapp-raycast.plist` for auto-start on login.

## 2. Raycast Extension (`raycast-whatsapp/`)

**Main Command: "WhatsApp"**
- Shows list of favorite contacts (manually configured in extension preferences)
- Type to fuzzy-search ALL WhatsApp contacts
- Enter on contact → opens "Compose Message" form
- Cmd+K actions: "View Conversation", "Send Message"

**Compose Message View:**
- Text input field
- Detects clipboard image → shows "Attach clipboard image?" option
- Enter sends message, closes and shows success toast

**View Conversation Action:**
- Shows last 10 messages in compact markdown format
- Your messages vs their messages clearly distinguished

**Extension Preferences:**
- `favoriteNumbers`: Comma-separated phone numbers for favorites (e.g., "+1234567890,+0987654321")
- `servicePort`: Local service port (default 3847)

## 3. First-Time Setup Flow

1. User installs LaunchAgent (one command)
2. Opens Raycast extension → sees "Not connected" state
3. Selects "Scan QR Code" action → displays QR in Raycast
4. User scans with phone → connected → shows contacts

## Key Files

```
whatsapp-service/
├── src/
│   ├── index.ts          # Express server + whatsapp-web.js client
│   ├── routes.ts         # API endpoints
│   └── whatsapp.ts       # WhatsApp client wrapper
├── package.json
└── tsconfig.json

raycast-whatsapp/
├── src/
│   ├── index.tsx         # Main contacts list view
│   ├── compose.tsx       # Send message form
│   ├── conversation.tsx  # View messages
│   ├── api.ts            # HTTP client to local service
│   └── preferences.ts    # Type definitions for prefs
├── package.json
└── raycast.config.ts
```

## Installation

After building:
1. `cd whatsapp-service && npm install && npm run build`
2. Install LaunchAgent: `cp com.whatsapp-raycast.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.whatsapp-raycast.plist`
3. Import Raycast extension: `cd raycast-whatsapp && npm install && npm run dev`
4. Open Raycast, search "WhatsApp", scan QR once
5. Configure favorite numbers in extension preferences
