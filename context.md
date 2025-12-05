# WhatsApp Raycast Extension - Project Context

## Purpose
Fast keyboard-driven WhatsApp messaging via Raycast, using a local background service.

## Architecture
Two-component system:
1. **whatsapp-service/** - Node.js + Express + whatsapp-web.js background service (port 3847)
2. **raycast-whatsapp/** - Raycast extension (TypeScript/React)

## Tech Stack
- **Service**: Node.js, Express, whatsapp-web.js, TypeScript
- **Extension**: Raycast API, TypeScript, React

## Key Files

### whatsapp-service/
- `src/index.ts` - Express server entry point
- `src/routes.ts` - REST API endpoints
- `src/whatsapp.ts` - WhatsApp client wrapper with session persistence
- `com.whatsapp-raycast.plist` - LaunchAgent for auto-start

### raycast-whatsapp/
- `src/index.tsx` - Main contacts list view
- `src/compose.tsx` - Message composition form
- `src/conversation.tsx` - Chat history view
- `src/qr.tsx` - QR code authentication view
- `src/api.ts` - HTTP client for service
- `src/preferences.ts` - Extension preferences handling

## API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Connection status |
| `/qr` | GET | QR code for auth |
| `/contacts` | GET | All contacts |
| `/chats/:chatId/messages` | GET | Chat messages |
| `/send` | POST | Send text |
| `/send-image` | POST | Send base64 image |

## Extension Features
- Favorites (configured via preferences)
- Fuzzy contact search
- Clipboard image attachment detection
- QR code scanning flow
- Conversation history viewing

## Session Storage
`~/.whatsapp-raycast/session/` - Persists WhatsApp authentication

## Project Status Board

| Task | Status |
|------|--------|
| Service setup (Express + whatsapp-web.js) | ✅ Complete |
| REST API endpoints | ✅ Complete |
| LaunchAgent for auto-start | ✅ Complete |
| Raycast extension scaffold | ✅ Complete |
| Contacts list view | ✅ Complete |
| Compose message form | ✅ Complete |
| Conversation view | ✅ Complete |
| QR code auth flow | ✅ Complete |

## Lessons Learned
- whatsapp-web.js requires Chromium/Puppeteer
- Session persistence via LocalAuth strategy
- Raycast clipboard API for image detection

## Next Steps
1. Test end-to-end flow
2. Add proper WhatsApp icon to extension
3. Consider adding message notifications
