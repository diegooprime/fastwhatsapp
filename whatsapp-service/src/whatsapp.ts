import { Client, LocalAuth, Message, Contact, Chat } from "whatsapp-web.js";
import * as QRCode from "qrcode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

const SESSION_PATH = path.join(os.homedir(), ".whatsapp-raycast", "session");
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute
const RECONNECT_DELAY = 5000; // 5 seconds

export type ConnectionStatus = "disconnected" | "connecting" | "qr" | "authenticated" | "ready";

class WhatsAppClient {
  private client: Client;
  private currentQR: string | null = null;
  private status: ConnectionStatus = "disconnected";
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isReconnecting: boolean = false;

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

    this.client.on("loading_screen", (percent, message) => {
      console.log(`[WhatsApp] Loading: ${percent}% - ${message}`);
    });

    this.client.on("ready", () => {
      console.log("[WhatsApp] Client is ready");
      this.status = "ready";
    });

    this.client.on("disconnected", (reason) => {
      console.log("[WhatsApp] Disconnected:", reason);
      this.status = "disconnected";
      this.currentQR = null;
      // Trigger automatic reconnection
      this.reconnect();
    });

    this.client.on("change_state", (state) => {
      console.log("[WhatsApp] State changed:", state);
    });

    // Message event handler - no logging of sender info for privacy
    this.client.on("message", () => {});
  }

  async initialize(): Promise<void> {
    console.log("[WhatsApp] Initializing client...");
    this.status = "connecting";
    try {
      await this.client.initialize();
      this.startHealthCheck();
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      console.error("[WhatsApp] Initialization failed:", errorMsg);
      
      // Detect session corruption and auto-clear
      if (errorMsg.includes("Target closed") || 
          errorMsg.includes("Session") || 
          errorMsg.includes("Protocol error") ||
          errorMsg.includes("Navigation") ||
          errorMsg.includes("disconnected")) {
        console.log("[WhatsApp] Detected corrupted session, clearing and retrying...");
        await this.clearSession();
        // Recreate client and retry once
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
        await this.client.initialize();
        this.startHealthCheck();
      } else {
        throw error;
      }
    }
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  async destroy(): Promise<void> {
    console.log("[WhatsApp] Destroying client...");
    this.stopHealthCheck();
    try {
      await this.client.destroy();
      console.log("[WhatsApp] Client destroyed successfully");
    } catch (error) {
      console.error("[WhatsApp] Error destroying client:", error);
    }
    this.status = "disconnected";
    this.currentQR = null;
  }

  async reconnect(): Promise<void> {
    if (this.isReconnecting) {
      console.log("[WhatsApp] Already reconnecting, skipping...");
      return;
    }

    this.isReconnecting = true;
    console.log("[WhatsApp] Attempting to reconnect...");

    try {
      // Destroy existing client
      await this.destroy();

      // Wait before reconnecting
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY));

      // Create new client
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

      // Initialize
      await this.initialize();
      console.log("[WhatsApp] Reconnection successful");
    } catch (error) {
      console.error("[WhatsApp] Reconnection failed:", error);
      this.status = "disconnected";
    } finally {
      this.isReconnecting = false;
    }
  }

  private async clearSession(): Promise<void> {
    console.log("[WhatsApp] Clearing session data...");
    try {
      if (fs.existsSync(SESSION_PATH)) {
        fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        console.log("[WhatsApp] Session cleared successfully");
      }
    } catch (error) {
      console.error("[WhatsApp] Error clearing session:", error);
    }
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    console.log("[WhatsApp] Starting health check...");
    this.healthCheckInterval = setInterval(async () => {
      if (this.status === "ready") {
        try {
          // Simple health check - try to get client state
          const state = await this.client.getState();
          if (!state) {
            console.log("[WhatsApp] Health check failed: no state");
            this.reconnect();
          }
        } catch (error) {
          console.error("[WhatsApp] Health check failed:", error);
          this.reconnect();
        }
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  async getQRCode(): Promise<string | null> {
    if (!this.currentQR) return null;
    return await QRCode.toDataURL(this.currentQR);
  }

  async getContacts(): Promise<Array<{ id: string; name: string; number: string; isGroup: boolean }>> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    const chats = await this.client.getChats();
    
    // Include both individual chats and groups
    const contactList = chats
      .filter((chat) => chat.id._serialized)
      .map((chat) => ({
        id: chat.id._serialized,
        name: chat.name || chat.id.user || chat.id._serialized,
        number: chat.id.user || "",
        isGroup: chat.isGroup,
      }));

    return contactList.sort((a, b) => a.name.localeCompare(b.name));
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
    hasMedia: boolean;
    mediaData?: string;
  }>> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    const chat = await this.client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit });

    const result = await Promise.all(
      messages.map(async (msg) => {
        let mediaData: string | undefined;
        
        if (msg.hasMedia) {
          try {
            const media = await msg.downloadMedia();
            if (media) {
              mediaData = `data:${media.mimetype};base64,${media.data}`;
            }
          } catch {
            // Failed to download media
          }
        }

        return {
          id: msg.id._serialized,
          body: msg.body,
          fromMe: msg.fromMe,
          timestamp: msg.timestamp,
          from: msg.from,
          hasMedia: msg.hasMedia,
          mediaData,
        };
      })
    );

    return result;
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
