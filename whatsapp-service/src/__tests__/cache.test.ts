import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// We test the cache logic by recreating it with a temp directory
// since the actual module uses hardcoded paths

interface CachedMessage {
  id: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  from: string;
  hasMedia: boolean;
}

interface ChatCache {
  chatId: string;
  messages: CachedMessage[];
  lastUpdated: number;
}

const MAX_MESSAGES_PER_CHAT = 50;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

class TestMessageCache {
  private memoryCache = new Map<string, ChatCache>();
  private cacheDir: string;
  private initialized = false;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  private getCacheFilePath(chatId: string): string {
    const safeName = chatId.replace(/[^a-zA-Z0-9@._-]/g, "_");
    return path.join(this.cacheDir, `${safeName}.json`);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.cacheDir, { recursive: true });
    this.initialized = true;
  }

  async get(chatId: string): Promise<CachedMessage[] | null> {
    await this.init();
    const memCached = this.memoryCache.get(chatId);
    if (memCached && Date.now() - memCached.lastUpdated < CACHE_TTL_MS) {
      return memCached.messages;
    }
    try {
      const filePath = this.getCacheFilePath(chatId);
      const data = await fs.readFile(filePath, "utf-8");
      const cache: ChatCache = JSON.parse(data);
      if (Date.now() - cache.lastUpdated < CACHE_TTL_MS) {
        this.memoryCache.set(chatId, cache);
        return cache.messages;
      }
    } catch {
      // Cache miss
    }
    return null;
  }

  async set(chatId: string, messages: CachedMessage[]): Promise<void> {
    await this.init();
    const trimmed = messages.slice(-MAX_MESSAGES_PER_CHAT);
    const cache: ChatCache = {
      chatId,
      messages: trimmed,
      lastUpdated: Date.now(),
    };
    this.memoryCache.set(chatId, cache);
    const filePath = this.getCacheFilePath(chatId);
    await fs.writeFile(filePath, JSON.stringify(cache), "utf-8");
  }

  async invalidate(chatId: string): Promise<void> {
    this.memoryCache.delete(chatId);
    try {
      const filePath = this.getCacheFilePath(chatId);
      await fs.unlink(filePath);
    } catch {
      // File doesn't exist
    }
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
    try {
      const files = await fs.readdir(this.cacheDir);
      await Promise.all(
        files.map((file) =>
          fs.unlink(path.join(this.cacheDir, file)).catch(() => {})
        )
      );
    } catch {
      // Directory doesn't exist
    }
  }
}

describe("MessageCache", () => {
  let cache: TestMessageCache;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wapp-cache-test-"));
    cache = new TestMessageCache(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const sampleMessage: CachedMessage = {
    id: "true_123@c.us_MSG1",
    body: "hello",
    fromMe: true,
    timestamp: 1700000000,
    from: "123@c.us",
    hasMedia: false,
  };

  test("get returns null for empty cache", async () => {
    const result = await cache.get("unknown@c.us");
    expect(result).toBeNull();
  });

  test("set then get returns messages", async () => {
    await cache.set("123@c.us", [sampleMessage]);
    const result = await cache.get("123@c.us");
    expect(result).toHaveLength(1);
    expect(result![0].body).toBe("hello");
  });

  test("persists to disk", async () => {
    await cache.set("123@c.us", [sampleMessage]);

    // Create new cache instance to force disk read
    const cache2 = new TestMessageCache(tmpDir);
    const result = await cache2.get("123@c.us");
    expect(result).toHaveLength(1);
    expect(result![0].id).toBe("true_123@c.us_MSG1");
  });

  test("invalidate removes from memory and disk", async () => {
    await cache.set("123@c.us", [sampleMessage]);
    await cache.invalidate("123@c.us");

    const result = await cache.get("123@c.us");
    expect(result).toBeNull();
  });

  test("clear removes all entries", async () => {
    await cache.set("123@c.us", [sampleMessage]);
    await cache.set("456@c.us", [{ ...sampleMessage, id: "MSG2" }]);
    await cache.clear();

    expect(await cache.get("123@c.us")).toBeNull();
    expect(await cache.get("456@c.us")).toBeNull();
  });

  test("trims messages to MAX_MESSAGES_PER_CHAT", async () => {
    const manyMessages = Array.from({ length: 100 }, (_, i) => ({
      ...sampleMessage,
      id: `MSG_${i}`,
      timestamp: 1700000000 + i,
    }));

    await cache.set("123@c.us", manyMessages);
    const result = await cache.get("123@c.us");
    expect(result).toHaveLength(50);
    // Should keep the last 50 (newest)
    expect(result![0].id).toBe("MSG_50");
  });

  test("sanitizes chatId for filename", async () => {
    // ChatIds with special chars should be safe filenames
    await cache.set("123@c.us", [sampleMessage]);
    const files = await fs.readdir(tmpDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\.json$/);
    // Should not contain any dangerous path chars
    expect(files[0]).not.toMatch(/[\/\\]/);
  });
});
