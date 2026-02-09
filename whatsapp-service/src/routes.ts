import { Router, Request, Response } from "express";
import { whatsappClient } from "./whatsapp";
import { messageCache, CachedMessage } from "./cache";

const router = Router();

// GET /status - Check connection status
router.get("/status", (req: Request, res: Response) => {
  try {
    const status = whatsappClient.getStatus();
    res.json({ status, ready: status === "ready" });
  } catch (error) {
    res.status(500).json({ error: "Failed to get status" });
  }
});

// GET /qr - Get QR code for authentication
router.get("/qr", async (req: Request, res: Response) => {
  try {
    const status = whatsappClient.getStatus();
    
    if (status === "ready") {
      res.json({ qr: null, message: "Already authenticated" });
      return;
    }

    const qrDataUrl = await whatsappClient.getQRCode();
    
    if (!qrDataUrl) {
      res.json({ qr: null, message: "QR code not available yet. Please wait..." });
      return;
    }

    res.json({ qr: qrDataUrl });
  } catch (error) {
    console.error("[Routes] QR error:", error);
    res.status(500).json({ error: "Failed to get QR code" });
  }
});

// GET /contacts - List all contacts
router.get("/contacts", async (req: Request, res: Response) => {
  try {
    const contacts = await whatsappClient.getContacts();
    res.json({ contacts });
  } catch (error: any) {
    console.error("[Routes] Contacts error:", error);
    res.status(500).json({ error: error.message || "Failed to get contacts" });
  }
});

// GET /chats - List all chats
router.get("/chats", async (req: Request, res: Response) => {
  try {
    const chats = await whatsappClient.getChats();
    res.json({ chats });
  } catch (error: any) {
    console.error("[Routes] Chats error:", error);
    res.status(500).json({ error: error.message || "Failed to get chats" });
  }
});

// POST /mark-read/:chatId - Mark a chat as read
router.post("/mark-read/:chatId", async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;
    await whatsappClient.markChatAsRead(chatId);
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Routes] Mark read error:", error);
    res.status(500).json({ error: error.message || "Failed to mark as read" });
  }
});

// GET /chats/:chatId/messages - Get recent messages from a chat
// Query params:
//   - limit: number of messages (default 10)
//   - cached: if "true", return cached messages only (instant)
//   - refresh: if "true", force fresh fetch even if cached
router.get("/chats/:chatId/messages", async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;
    const cachedOnly = req.query.cached === "true";
    const forceRefresh = req.query.refresh === "true";

    // If cached-only requested, return from cache immediately
    if (cachedOnly) {
      const cached = await messageCache.get(chatId);
      if (cached) {
        return res.json({ messages: cached, fromCache: true });
      }
      // No cache available - return empty (frontend will trigger refresh)
      return res.json({ messages: [], fromCache: true, empty: true });
    }

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = await messageCache.get(chatId);
      if (cached && cached.length > 0) {
        // Return cached data and trigger background update
        res.json({ messages: cached, fromCache: true });
        // Update cache in background (don't await)
        whatsappClient.getMessages(chatId, limit).then((fresh) => {
          const toCache: CachedMessage[] = fresh.map((m) => ({
            id: m.id,
            body: m.body,
            fromMe: m.fromMe,
            timestamp: m.timestamp,
            from: m.from,
            senderName: m.senderName,
            hasMedia: m.hasMedia,
            mediaType: m.mediaType,
          }));
          messageCache.set(chatId, toCache);
        }).catch((err) => {
          console.error("[Routes] Background refresh failed:", err.message);
        });
        return;
      }
    }

    // No cache or force refresh - fetch fresh
    const messages = await whatsappClient.getMessages(chatId, limit);

    // Cache the messages (without media data)
    const toCache: CachedMessage[] = messages.map((m) => ({
      id: m.id,
      body: m.body,
      fromMe: m.fromMe,
      timestamp: m.timestamp,
      from: m.from,
      senderName: m.senderName,
      hasMedia: m.hasMedia,
      mediaType: m.mediaType,
    }));
    messageCache.set(chatId, toCache);

    res.json({ messages, fromCache: false });
  } catch (error: any) {
    console.error("[Routes] Messages error:", error);
    res.status(500).json({ error: error.message || "Failed to get messages" });
  }
});

// POST /send - Send text message (optionally as reply)
router.post("/send", async (req: Request, res: Response) => {
  try {
    const { chatId, message, quotedMessageId } = req.body;

    if (!chatId || !message) {
      res.status(400).json({ error: "chatId and message are required" });
      return;
    }

    const result = await whatsappClient.sendMessage(chatId, message, quotedMessageId);
    res.json(result);
  } catch (error: any) {
    console.error("[Routes] Send error:", error);
    res.status(500).json({ error: error.message || "Failed to send message" });
  }
});

// POST /send-image - Send image from base64
router.post("/send-image", async (req: Request, res: Response) => {
  try {
    const { chatId, base64, caption } = req.body;

    if (!chatId || !base64) {
      res.status(400).json({ error: "chatId and base64 are required" });
      return;
    }

    const result = await whatsappClient.sendImage(chatId, base64, caption);
    res.json(result);
  } catch (error: any) {
    console.error("[Routes] Send image error:", error);
    res.status(500).json({ error: error.message || "Failed to send image" });
  }
});

// POST /resolve-number - Get chatId from phone number
router.post("/resolve-number", async (req: Request, res: Response) => {
  try {
    const { number } = req.body;

    if (!number) {
      res.status(400).json({ error: "number is required" });
      return;
    }

    const chatId = await whatsappClient.getChatIdFromNumber(number);
    
    if (!chatId) {
      res.status(404).json({ error: "Number not registered on WhatsApp" });
      return;
    }

    res.json({ chatId });
  } catch (error: any) {
    console.error("[Routes] Resolve number error:", error);
    res.status(500).json({ error: error.message || "Failed to resolve number" });
  }
});

// POST /react - React to a message with an emoji
router.post("/react", async (req: Request, res: Response) => {
  try {
    const { messageId, emoji } = req.body;

    if (!messageId || !emoji) {
      res.status(400).json({ error: "messageId and emoji are required" });
      return;
    }

    const result = await whatsappClient.reactToMessage(messageId, emoji);
    res.json(result);
  } catch (error: any) {
    console.error("[Routes] React error:", error);
    res.status(500).json({ error: error.message || "Failed to react" });
  }
});

// POST /download-media - Download media from a message
router.post("/download-media", async (req: Request, res: Response) => {
  try {
    const { messageId } = req.body;
    console.log("[Routes] Download media request for:", messageId);

    if (!messageId) {
      res.status(400).json({ error: "messageId is required" });
      return;
    }

    const media = await whatsappClient.downloadMedia(messageId);
    if (!media) {
      console.log("[Routes] Media not found for:", messageId);
      res.status(404).json({ error: "Media not found" });
      return;
    }

    console.log("[Routes] Media downloaded successfully, mimetype:", media.mimetype);
    res.json(media);
  } catch (error: any) {
    console.error("[Routes] Download media error:", error.message);
    res.status(500).json({ error: error.message || "Failed to download media" });
  }
});

export default router;
