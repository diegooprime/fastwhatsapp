import { Router, Request, Response } from "express";
import { whatsappClient } from "./whatsapp";

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

// GET /chats/:chatId/messages - Get recent messages from a chat
router.get("/chats/:chatId/messages", async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;

    const messages = await whatsappClient.getMessages(chatId, limit);
    res.json({ messages });
  } catch (error: any) {
    console.error("[Routes] Messages error:", error);
    res.status(500).json({ error: error.message || "Failed to get messages" });
  }
});

// POST /send - Send text message
router.post("/send", async (req: Request, res: Response) => {
  try {
    const { chatId, message } = req.body;

    if (!chatId || !message) {
      res.status(400).json({ error: "chatId and message are required" });
      return;
    }

    const result = await whatsappClient.sendMessage(chatId, message);
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

export default router;
