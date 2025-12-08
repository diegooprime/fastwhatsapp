import { Client, LocalAuth, Message, Contact, Chat } from "whatsapp-web.js";
import * as QRCode from "qrcode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";

const SESSION_PATH = path.join(os.homedir(), ".whatsapp-raycast", "session");

export type ConnectionStatus = "disconnected" | "connecting" | "qr" | "authenticated" | "ready";

class WhatsAppClient {
  private client!: Client;
  private currentQR: string | null = null;
  private status: ConnectionStatus = "disconnected";
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isDestroying: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private isReconnecting: boolean = false;

  constructor() {
    this.createClient();
  }

  private createClient() {
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: SESSION_PATH,
      }),
      puppeteer: {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
        ],
      },
      // Let whatsapp-web.js fetch the latest WhatsApp Web version automatically
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
      this.reconnectAttempts = 0; // Reset on successful connection
      this.startHealthCheck();
    });

    this.client.on("disconnected", (reason) => {
      console.log("[WhatsApp] Disconnected:", reason);
      this.status = "disconnected";
      this.currentQR = null;
      if (!this.isDestroying) {
        console.log("[WhatsApp] Attempting to reconnect...");
        this.reconnect();
      }
    });

    this.client.on("change_state", (state) => {
      console.log("[WhatsApp] State changed:", state);
    });

    this.client.on("message", (msg) => {
      // Removed sensitive logging
      console.log("[WhatsApp] Message received");
    });
  }

  async initialize(): Promise<void> {
    console.log("[WhatsApp] Initializing client...");
    this.status = "connecting";
    try {
      await this.client.initialize();
    } catch (error: any) {
      console.error("[WhatsApp] Failed to initialize:", error.message);
      
      // Handle browser already running (orphan Chrome processes)
      if (error.message?.includes("browser is already running") || 
          error.message?.includes("already running for")) {
        console.log("[WhatsApp] Detected orphan browser. Cleaning up and retrying...");
        await this.killOrphanBrowsers();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Recreate client and try again
        this.createClient();
        try {
          await this.client.initialize();
          return;
        } catch (retryError: any) {
          console.error("[WhatsApp] Retry after cleanup failed:", retryError.message);
        }
      }
      
      if (error.message?.includes("Target closed") || error.message?.includes("Session closed")) {
        console.log("[WhatsApp] Detected session corruption. Clearing session and retrying...");
        await this.clearSession();
        await this.reconnect();
      } else {
        this.status = "disconnected";
        throw error;
      }
    }
  }

  private async killOrphanBrowsers(): Promise<void> {
    console.log("[WhatsApp] Killing orphan Chrome processes...");
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    
    try {
      // Kill Chrome for Testing processes that are using our session directory
      await execAsync('pkill -9 -f "Google Chrome for Testing.*whatsapp-raycast" || true');
      // Also remove any stale SingletonLock files
      await execAsync(`rm -f "${SESSION_PATH}/SingletonLock" "${SESSION_PATH}/SingletonCookie" "${SESSION_PATH}/SingletonSocket" 2>/dev/null || true`);
    } catch (e) {
      // Ignore errors - best effort cleanup
    }
  }

  async destroy(): Promise<void> {
    this.isDestroying = true;
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    try {
      await this.client.destroy();
    } catch (error) {
      console.error("[WhatsApp] Error during destroy:", error);
    }
    this.status = "disconnected";
  }

  async reconnect(): Promise<void> {
    if (this.isDestroying || this.isReconnecting) return;
    
    this.isReconnecting = true;
    this.reconnectAttempts++;
    
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    console.log(`[WhatsApp] Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`);
    
    try {
      await this.client.destroy();
    } catch (e) {
      // Ignore destroy errors during reconnect
    }

    await new Promise(resolve => setTimeout(resolve, delay));
    
    if (this.isDestroying) {
      this.isReconnecting = false;
      return;
    }
    
    try {
      this.createClient();
      await this.initialize();
      // Success - reset attempts
      this.reconnectAttempts = 0;
      console.log("[WhatsApp] Reconnected successfully");
    } catch (error: any) {
      console.error("[WhatsApp] Reconnect failed:", error.message);
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.isReconnecting = false;
        // Try again
        this.reconnect();
      } else {
        console.error("[WhatsApp] Max reconnect attempts reached. Manual restart required.");
        this.status = "disconnected";
      }
    } finally {
      this.isReconnecting = false;
    }
  }

  async clearSession(): Promise<void> {
    console.log("[WhatsApp] Clearing session files...");
    try {
      await this.client.destroy();
    } catch (e) {
      // Ignore
    }
    
    try {
      await fs.rm(SESSION_PATH, { recursive: true, force: true });
    } catch (error) {
      console.error("[WhatsApp] Failed to clear session:", error);
    }
  }

  private startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Check every 30 seconds for faster detection of issues
    this.healthCheckInterval = setInterval(async () => {
      if (this.status === "ready" && !this.isDestroying && !this.isReconnecting) {
        try {
          // Simple check to see if we can get state
          const state = await this.client.getState();
          if (!state) {
            throw new Error("No state returned");
          }
          // Reset reconnect attempts on successful health check
          this.reconnectAttempts = 0;
        } catch (error: any) {
          console.error("[WhatsApp] Health check failed:", error.message);
          this.status = "disconnected";
          console.log("[WhatsApp] Triggering reconnect from health check");
          this.reconnect().catch(e => console.error("[WhatsApp] Reconnect failed:", e));
        }
      }
    }, 30 * 1000);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  // Wrapper to handle stale connections - if an operation fails with a detached/closed error, trigger reconnect
  private async withReconnect<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      const message = error.message || "";
      if (
        message.includes("detached") ||
        message.includes("Target closed") ||
        message.includes("Session closed") ||
        message.includes("Protocol error") ||
        message.includes("timed out") ||
        message.includes("browser has disconnected")
      ) {
        console.log("[WhatsApp] Connection lost, triggering reconnect...");
        this.status = "disconnected";
        // Don't await - let it reconnect in background
        this.reconnect().catch(e => console.error("[WhatsApp] Reconnect failed:", e));
        throw new Error("Connection lost, reconnecting...");
      }
      throw error;
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

    return this.withReconnect(async () => {
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
    });
  }

  async getChats(): Promise<Array<{ id: string; name: string; unreadCount: number; lastMessage?: string }>> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    return this.withReconnect(async () => {
      const chats = await this.client.getChats();
      
      return chats.map((chat) => ({
        id: chat.id._serialized,
        name: chat.name,
        unreadCount: chat.unreadCount,
        lastMessage: chat.lastMessage?.body,
      }));
    });
  }

  async getMessages(chatId: string, limit: number = 10): Promise<Array<{
    id: string;
    body: string;
    fromMe: boolean;
    timestamp: number;
    from: string;
    hasMedia: boolean;
    mediaData?: string;
    mediaType?: "image" | "video" | "audio" | "sticker" | "document" | "unknown";
  }>> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    return this.withReconnect(async () => {
      const chat = await this.client.getChatById(chatId);
      const messages = await chat.fetchMessages({ limit });

      const result = await Promise.all(
        messages.map(async (msg) => {
          let mediaData: string | undefined;
          let mediaType: "image" | "video" | "audio" | "sticker" | "document" | "unknown" | undefined;
          
          if (msg.hasMedia) {
            // Check message type BEFORE downloading to avoid downloading large videos/audio
            const msgType = (msg as any).type as string;
            
            if (msgType === "video") {
              mediaType = "video";
              // Skip download for videos - too large
            } else if (msgType === "audio" || msgType === "ptt") {
              mediaType = "audio";
              // Skip download for audio/voice messages
            } else if (msgType === "document") {
              mediaType = "document";
              // Skip download for documents
            } else if (msgType === "sticker") {
              mediaType = "sticker";
              // Download stickers - they're small
              try {
                const media = await msg.downloadMedia();
                if (media) {
                  mediaData = `data:${media.mimetype};base64,${media.data}`;
                }
              } catch {
                // Failed to download
              }
            } else if (msgType === "image") {
              mediaType = "image";
              // Download images
              try {
                const media = await msg.downloadMedia();
                if (media) {
                  mediaData = `data:${media.mimetype};base64,${media.data}`;
                }
              } catch {
                // Failed to download
              }
            } else {
              // Unknown media type - try to download and detect
              mediaType = "unknown";
              try {
                const media = await msg.downloadMedia();
                if (media) {
                  const mime = media.mimetype.toLowerCase();
                  if (mime.startsWith("image/")) {
                    mediaType = "image";
                    mediaData = `data:${media.mimetype};base64,${media.data}`;
                  }
                }
              } catch {
                // Failed to download
              }
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
            mediaType,
          };
        })
      );

      return result;
    });
  }

  async sendMessage(chatId: string, message: string): Promise<{ success: boolean; messageId?: string }> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    return this.withReconnect(async () => {
      const chat = await this.client.getChatById(chatId);
      const sentMsg = await chat.sendMessage(message);

      return {
        success: true,
        messageId: sentMsg.id._serialized,
      };
    });
  }

  async sendImage(chatId: string, base64: string, caption?: string): Promise<{ success: boolean; messageId?: string }> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    return this.withReconnect(async () => {
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
    });
  }

  async getChatIdFromNumber(number: string): Promise<string | null> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    return this.withReconnect(async () => {
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
    });
  }

  async reactToMessage(messageId: string, emoji: string): Promise<{ success: boolean }> {
    if (this.status !== "ready") {
      throw new Error("Client not ready");
    }

    return this.withReconnect(async () => {
      // Get the message by ID and react to it
      // messageId format is: "true_chatId_messageId" or "false_chatId_messageId"
      const parts = messageId.split("_");
      if (parts.length < 3) {
        throw new Error("Invalid message ID format");
      }

      const chatId = parts.slice(1, -1).join("_");
      const chat = await this.client.getChatById(chatId);
      const messages = await chat.fetchMessages({ limit: 50 });
      
      const message = messages.find(m => m.id._serialized === messageId);
      if (!message) {
        throw new Error("Message not found");
      }

      await message.react(emoji);
      return { success: true };
    });
  }
}

export const whatsappClient = new WhatsAppClient();
