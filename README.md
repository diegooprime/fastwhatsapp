# FastWhatsApp

Raycast extension to send WhatsApp messages without leaving the keyboard.

I built this because switching to WhatsApp breaks my flow. Now it's ⌘+Space away.

## Demo
https://x.com/diegooprime/status/1997915809256185982

## How it works

Two parts:
1. **whatsapp-service** - Local Node.js server that connects to WhatsApp Web
2. **raycast-whatsapp** - Raycast extension that talks to the service

Runs entirely on localhost. No external servers.

## Setup

Requires Node 18+, Raycast, macOS.
```bash
git clone https://github.com/diegooprime/fastwhatsapp.git
cd fastwhatsapp/whatsapp-service
npm install && npm run build
npm start
```

Get your API key:
```bash
cat ~/.whatsapp-raycast/api-key
```

Install the extension:
```bash
cd ../raycast-whatsapp
npm install && npm run dev
```

Open Raycast → WhatsApp → paste API key in preferences → scan QR code.

For background service setup, see `whatsapp-service/com.whatsapp-raycast.plist`.

## Usage

| Action | Shortcut |
|--------|----------|
| Send message | ⌘ + Enter |
| Attach image | ⌘ + V |
| Refresh | ⌘ + R |

## Troubleshooting

**Raycast says "WhatsApp Not Connected" even after scanning QR**

This usually means the backend is stuck in an authenticated-but-not-ready state due to a WhatsApp Web change.
Common log message:
`Connected but chats not ready: Cannot read properties of undefined (reading 'update')`

Fix (run on the machine hosting `whatsapp-service`, then re-open Raycast and scan QR if prompted):
```bash
cd /path/to/whatsapp-service
PUPPETEER_SKIP_DOWNLOAD=1 npm install whatsapp-web.js@latest
npm run build
sudo systemctl restart whatsapp-service
```

**Quick health checks**
```bash
curl -s http://<HOST>:3847/health
curl -s -H "X-API-Key: $(cat ~/.whatsapp-raycast/api-key)" http://<HOST>:3847/status
```
Expected: `health` returns `ok:true`, and `status` is `ready:true` when fully connected.

## License

MIT - do whatever you want with it.
