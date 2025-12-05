import { Client, LocalAuth, Message, Contact, Chat } from "whatsapp-web.js";
import * as QRCode from "qrcode";
import * as path from "path";
import * as os from "os";

const SESSION_PATH = path.join(os.homedir(), ".whatsapp-raycast", "session");

export type ConnectionStatus = "disconnected" | "connecting" | "qr" | "authenticated" | "ready";

class WhatsAppClient {
  private client: Client;
  private currentQR: string | null = null;
  private status: ConnectionStatus = "disconnected";

  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: SESSION_PATH,
      }),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on("qr", async (qr) => {
      console.log("[WhatsApp] QR code received");
      this.currentQR = qr;
      this.status = "qr";
    });

    this.client.on("authenticated", () => {
      console.log("[WhatsApp] Authenticated");
      this.currentQR = null;
      this.status = "authenticated";
    });

    this.client.on("auth_failure", (msg) => {
      console.error("[WhatsApp] Auth failure:", msg);
      this.status = "disconnected";
    });

    this.client.on("ready", () => {
      console.log("[WhatsApp] Client is ready");
      this.status = "ready";
    });

    this.client.on("disconnected", (reason) => {
      console.log("[WhatsApp] Disconnected:", reason);
      this.status = "disconnected";
      this.currentQR = null;
    });
  }

  async initialize(): Promise<void> {
    console.log("[WhatsApp] Initializing client...");
    this.status = "connecting";
    await this.client.initialize();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  async getQRCode(): Promise<string | null> {
    if (!this.currentQR) return null;
    return await QRCode.toDataURL(this.currentQR);
  }

  async getContacts(): Promise<Array<{ id: string; name: string; number: string; isMyContact: boolean }>> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    const contacts = await this.client.getContacts();
    
    return contacts
      .filter((c) => c.isWAContact && c.id.user)
      .map((c) => ({
        id: c.id._serialized,
        name: c.name || c.pushname || c.id.user,
        number: c.id.user,
        isMyContact: c.isMyContact,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getChats(): Promise<Array<{ id: string; name: string; unreadCount: number; lastMessage?: string }>> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    const chats = await this.client.getChats();
    
    return chats.map((chat) => ({
      id: chat.id._serialized,
      name: chat.name,
      unreadCount: chat.unreadCount,
      lastMessage: chat.lastMessage?.body,
    }));
  }

  async getMessages(chatId: string, limit: number = 10): Promise<Array<{
    id: string;
    body: string;
    fromMe: boolean;
    timestamp: number;
    from: string;
  }>> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    const chat = await this.client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit });

    return messages.map((msg) => ({
      id: msg.id._serialized,
      body: msg.body,
      fromMe: msg.fromMe,
      timestamp: msg.timestamp,
      from: msg.from,
    }));
  }

  async sendMessage(chatId: string, message: string): Promise<{ success: boolean; messageId?: string }> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    const chat = await this.client.getChatById(chatId);
    const sentMsg = await chat.sendMessage(message);

    return {
      success: true,
      messageId: sentMsg.id._serialized,
    };
  }

  async sendImage(chatId: string, base64: string, caption?: string): Promise<{ success: boolean; messageId?: string }> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    const { MessageMedia } = await import("whatsapp-web.js");
    
    // Extract mime type from base64 if present
    let mimeType = "image/png";
    let data = base64;
    
    if (base64.includes(",")) {
      const match = base64.match(/data:([^;]+);base64,(.+)/);
      if (match) {
        mimeType = match[1];
        data = match[2];
      }
    }

    const media = new MessageMedia(mimeType, data);
    const chat = await this.client.getChatById(chatId);
    const sentMsg = await chat.sendMessage(media, { caption });

    return {
      success: true,
      messageId: sentMsg.id._serialized,
    };
  }

  async getChatIdFromNumber(number: string): Promise<string | null> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    // Normalize number - remove + and any spaces/dashes
    const normalized = number.replace(/[\s\-\+]/g, "");
    const chatId = `${normalized}@c.us`;

    try {
      const isRegistered = await this.client.isRegisteredUser(chatId);
      if (isRegistered) {
        return chatId;
      }
    } catch (err) {
      console.error("[WhatsApp] Error checking number:", err);
    }

    return null;
  }
}

export const whatsappClient = new WhatsAppClient();
