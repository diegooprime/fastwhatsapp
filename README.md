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

## License

MIT - do whatever you want with it.