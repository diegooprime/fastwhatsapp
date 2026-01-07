import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const CACHE_DIR = path.join(os.homedir(), ".whatsapp-raycast", "cache");
const MAX_MESSAGES_PER_CHAT = 50;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CachedMessage {
  id: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  from: string;
  senderName?: string;
  hasMedia: boolean;
  mediaType?: "image" | "video" | "audio" | "sticker" | "document" | "unknown";
  // Note: mediaData is NOT cached - always loaded on demand
}

interface ChatCache {
  chatId: string;
  messages: CachedMessage[];
  lastUpdated: number;
}

class MessageCache {
  private memoryCache = new Map<string, ChatCache>();
  private initialized = false;

  private getCacheFilePath(chatId: string): string {
    // Sanitize chatId for filename
    const safeName = chatId.replace(/[^a-zA-Z0-9@._-]/g, "_");
    return path.join(CACHE_DIR, `${safeName}.json`);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      this.initialized = true;
    } catch (error) {
      console.error("[Cache] Failed to create cache directory:", error);
    }
  }

  async get(chatId: string): Promise<CachedMessage[] | null> {
    await this.init();

    // Check memory cache first
    const memCached = this.memoryCache.get(chatId);
    if (memCached && Date.now() - memCached.lastUpdated < CACHE_TTL_MS) {
      return memCached.messages;
    }

    // Try disk cache
    try {
      const filePath = this.getCacheFilePath(chatId);
      const data = await fs.readFile(filePath, "utf-8");
      const cache: ChatCache = JSON.parse(data);

      // Check TTL
      if (Date.now() - cache.lastUpdated < CACHE_TTL_MS) {
        // Store in memory for faster subsequent access
        this.memoryCache.set(chatId, cache);
        return cache.messages;
      }
    } catch {
      // Cache miss or invalid - that's fine
    }

    return null;
  }

  async set(chatId: string, messages: CachedMessage[]): Promise<void> {
    await this.init();

    // Keep only the most recent messages
    const trimmed = messages.slice(-MAX_MESSAGES_PER_CHAT);

    const cache: ChatCache = {
      chatId,
      messages: trimmed,
      lastUpdated: Date.now(),
    };

    // Update memory cache immediately
    this.memoryCache.set(chatId, cache);

    // Write to disk asynchronously (don't block)
    const filePath = this.getCacheFilePath(chatId);
    fs.writeFile(filePath, JSON.stringify(cache), "utf-8").catch((error) => {
      console.error("[Cache] Failed to write cache:", error);
    });
  }

  async invalidate(chatId: string): Promise<void> {
    this.memoryCache.delete(chatId);
    try {
      const filePath = this.getCacheFilePath(chatId);
      await fs.unlink(filePath);
    } catch {
      // File doesn't exist - that's fine
    }
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
    try {
      const files = await fs.readdir(CACHE_DIR);
      await Promise.all(
        files.map((file) => fs.unlink(path.join(CACHE_DIR, file)).catch(() => {}))
      );
    } catch {
      // Directory doesn't exist - that's fine
    }
  }
}

export const messageCache = new MessageCache();
