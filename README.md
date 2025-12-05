# WhatsApp Raycast Extension

A Raycast extension for fast keyboard-driven WhatsApp messaging, powered by a local Node.js service.

## Architecture

```
┌─────────────────┐     HTTP localhost:3847     ┌──────────────────────┐
│ Raycast Extension│ ◄──────────────────────────► │ whatsapp-web.js      │
│ (UI + Actions)   │                             │ Background Service   │
└─────────────────┘                             └──────────────────────┘
                                                         │
                                                         ▼
                                                  WhatsApp Web
```

## Installation

### 1. Install the Background Service

```bash
cd whatsapp-service
npm install
npm run build
```

### 2. Set Up LaunchAgent (Auto-start on Login)

First, edit `com.whatsapp-raycast.plist` to update the path to your Node.js installation:

```bash
# Find your Node path
which node
# Usually: /usr/local/bin/node or /opt/homebrew/bin/node
```

Then install the LaunchAgent:

```bash
# Copy plist to LaunchAgents
cp com.whatsapp-raycast.plist ~/Library/LaunchAgents/

# Load the service
launchctl load ~/Library/LaunchAgents/com.whatsapp-raycast.plist

# Verify it's running
curl http://localhost:3847/health
```

### 3. Install Raycast Extension

```bash
cd raycast-whatsapp
npm install
npm run dev
```

This will open the extension in Raycast development mode.

### 4. First-Time Setup

1. Open Raycast and search "WhatsApp"
2. You'll see "QR Code Available" - press Enter
3. Scan the QR code with your phone (WhatsApp > Settings > Linked Devices)
4. Once connected, your contacts will appear

### 5. Configure Favorites (Optional)

In Raycast, go to Extension Preferences:
- Set `favoriteNumbers` to comma-separated phone numbers (e.g., `+1234567890,+0987654321`)
- These contacts will appear at the top of your list

## Usage

- **Open WhatsApp**: Search "WhatsApp" in Raycast
- **Search Contacts**: Type to filter contacts
- **Send Message**: Press Enter on a contact
- **View Conversation**: Press Cmd+K → View Conversation
- **Attach Image**: If there's an image in your clipboard, you'll see an option to attach it

## Service Management

```bash
# Start service manually (for testing)
cd whatsapp-service && npm run dev

# Check logs
tail -f /tmp/whatsapp-raycast.log
tail -f /tmp/whatsapp-raycast.error.log

# Restart service
launchctl unload ~/Library/LaunchAgents/com.whatsapp-raycast.plist
launchctl load ~/Library/LaunchAgents/com.whatsapp-raycast.plist

# Stop service
launchctl unload ~/Library/LaunchAgents/com.whatsapp-raycast.plist
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Check connection status |
| `/qr` | GET | Get QR code for authentication |
| `/contacts` | GET | List all contacts |
| `/chats` | GET | List all chats |
| `/chats/:chatId/messages` | GET | Get messages (query: `limit`) |
| `/send` | POST | Send text message (`{ chatId, message }`) |
| `/send-image` | POST | Send image (`{ chatId, base64, caption? }`) |
| `/resolve-number` | POST | Get chatId from phone number |

## Troubleshooting

### Service not starting
- Check Node.js path in plist matches your system
- View logs: `tail -f /tmp/whatsapp-raycast.error.log`

### QR code not showing
- Ensure service is running: `curl http://localhost:3847/status`
- Check for existing session in `~/.whatsapp-raycast/session/`

### Connection lost
- Restart the service
- You may need to re-scan the QR code if session expired

## Session Storage

WhatsApp session is stored in `~/.whatsapp-raycast/session/` to persist across restarts.

To reset authentication, delete this folder and restart the service.
