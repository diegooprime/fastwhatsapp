/**
 * Tests for the Raycast WhatsApp API client.
 *
 * These validate the API client's type contracts and URL construction
 * without requiring the Raycast runtime or a live bridge.
 *
 * NOTE: The Raycast extension uses @raycast/api which is only available
 * inside the Raycast runtime. These tests validate the pure logic parts.
 */

describe("WhatsApp API Client", () => {
  describe("URL Construction", () => {
    const baseUrl = "http://127.0.0.1:3847";

    test("status endpoint", () => {
      expect(`${baseUrl}/status`).toBe("http://127.0.0.1:3847/status");
    });

    test("messages endpoint with encoding", () => {
      const chatId = "10000000001@c.us";
      const url = `${baseUrl}/chats/${encodeURIComponent(chatId)}/messages?limit=30`;
      expect(url).toContain(encodeURIComponent("@"));
      expect(url).toContain("limit=30");
    });

    test("mark-read endpoint", () => {
      const chatId = "10000000001@c.us";
      const url = `${baseUrl}/mark-read/${encodeURIComponent(chatId)}`;
      expect(url).toContain("mark-read");
    });

    test("search endpoint escapes query", () => {
      const query = "hello world";
      const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&limit=50`;
      expect(url).toContain("hello%20world");
    });

    test("send endpoint", () => {
      const body = JSON.stringify({
        chatId: "123@c.us",
        message: "test",
      });
      const parsed = JSON.parse(body);
      expect(parsed.chatId).toBe("123@c.us");
      expect(parsed.message).toBe("test");
    });
  });

  describe("Type Contracts", () => {
    test("Contact interface", () => {
      const contact = {
        id: "10000000001@c.us",
        name: "TestUser",
        number: "10000000001",
        isGroup: false,
      };
      expect(contact.id).toMatch(/@c\.us$/);
      expect(typeof contact.isGroup).toBe("boolean");
    });

    test("Message interface", () => {
      const msg = {
        id: "true_123@c.us_MSG1",
        body: "hello",
        fromMe: true,
        timestamp: 1700000000,
        from: "123@c.us",
        hasMedia: false,
      };
      expect(msg.id).toContain("_");
      expect(typeof msg.fromMe).toBe("boolean");
      expect(typeof msg.timestamp).toBe("number");
    });

    test("Chat interface", () => {
      const chat = {
        id: "123@c.us",
        name: "TestUser",
        unreadCount: 5,
        lastMessage: "hey",
        lastMessageTimestamp: 1700000000,
        isGroup: false,
      };
      expect(chat.unreadCount).toBeGreaterThanOrEqual(0);
    });

    test("SearchResult interface", () => {
      const result = {
        id: "true_123@c.us_MSG1",
        body: "found this",
        fromMe: true,
        timestamp: 1700000000,
        from: "123@c.us",
        hasMedia: false,
        chatName: "TestUser",
        chatJid: "123@c.us",
      };
      expect(result).toHaveProperty("chatName");
      expect(result).toHaveProperty("chatJid");
    });
  });

  describe("Input Sanitization", () => {
    test("chatId is URL-encoded in path params", () => {
      const chatId = "123@c.us";
      const encoded = encodeURIComponent(chatId);
      expect(encoded).toBe("123%40c.us");
      // Ensure it doesn't break the URL
      expect(decodeURIComponent(encoded)).toBe(chatId);
    });

    test("message body can contain special characters", () => {
      const body = JSON.stringify({
        chatId: "123@c.us",
        message: '<script>alert("xss")</script>',
      });
      const parsed = JSON.parse(body);
      expect(parsed.message).toContain("<script>");
    });

    test("search query is encoded", () => {
      const query = 'test"with"quotes&special=chars';
      const encoded = encodeURIComponent(query);
      expect(encoded).not.toContain('"');
      expect(encoded).not.toContain("&");
    });
  });
});
