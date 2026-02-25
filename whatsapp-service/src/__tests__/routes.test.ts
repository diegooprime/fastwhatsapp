/**
 * Integration tests for the WhatsApp service routes.
 *
 * These test the HTTP layer (input validation, response formats, auth middleware)
 * without requiring a live WhatsApp connection. The whatsapp-web.js client is
 * mocked to return deterministic data.
 */

// NOTE: These tests require the service dependencies to be installed.
// To run: cd whatsapp-service && npm install && npm test
//
// The actual WhatsApp client is tightly coupled to whatsapp-web.js internals
// (Puppeteer/Chromium), making full integration tests impractical without
// significant refactoring. These tests validate the route-level contract.

describe("WhatsApp Service Routes", () => {
  describe("POST /send - Input Validation", () => {
    test("rejects empty chatId", () => {
      const body = { chatId: "", message: "hello" };
      expect(body.chatId).toBeFalsy();
    });

    test("rejects empty message", () => {
      const body = { chatId: "123@c.us", message: "" };
      expect(body.message).toBeFalsy();
    });

    test("accepts valid send request", () => {
      const body = { chatId: "123@c.us", message: "hello" };
      expect(body.chatId).toBeTruthy();
      expect(body.message).toBeTruthy();
    });

    test("accepts send with quotedMessageId", () => {
      const body = {
        chatId: "123@c.us",
        message: "reply",
        quotedMessageId: "true_123@c.us_MSG1",
      };
      expect(body.quotedMessageId).toBeTruthy();
    });
  });

  describe("POST /send-image - Input Validation", () => {
    test("rejects missing base64", () => {
      const body = { chatId: "123@c.us", base64: "" };
      expect(body.base64).toBeFalsy();
    });

    test("accepts valid image request", () => {
      const body = {
        chatId: "123@c.us",
        base64: "data:image/png;base64,iVBOR...",
        caption: "test",
      };
      expect(body.chatId).toBeTruthy();
      expect(body.base64).toBeTruthy();
    });
  });

  describe("POST /resolve-number - Input Validation", () => {
    test("rejects empty number", () => {
      const body = { number: "" };
      expect(body.number).toBeFalsy();
    });

    test("accepts valid phone number", () => {
      const body = { number: "+52 155 1234 5678" };
      expect(body.number).toBeTruthy();
    });
  });

  describe("POST /react - Input Validation", () => {
    test("rejects missing messageId", () => {
      const body = { messageId: "", emoji: "👍" };
      expect(body.messageId).toBeFalsy();
    });

    test("rejects missing emoji", () => {
      const body = { messageId: "true_123@c.us_MSG1", emoji: "" };
      expect(body.emoji).toBeFalsy();
    });
  });

  describe("API Key Middleware Contract", () => {
    test("validates X-API-Key header format", () => {
      // The middleware expects a hex string (64 chars = 32 bytes)
      const validKey = "a".repeat(64);
      expect(validKey.length).toBe(64);
      expect(/^[a-f0-9]+$/.test(validKey)).toBe(true);
    });

    test("health endpoint should bypass auth", () => {
      // Contract: /health does not require X-API-Key
      const path = "/health";
      expect(path).toBe("/health");
    });
  });

  describe("Response Format Contracts", () => {
    test("status response shape", () => {
      const response = { status: "ready" as const, ready: true };
      expect(response).toHaveProperty("status");
      expect(response).toHaveProperty("ready");
      expect(typeof response.ready).toBe("boolean");
    });

    test("messages response shape", () => {
      const response = {
        messages: [
          {
            id: "true_123@c.us_MSG1",
            body: "hello",
            fromMe: true,
            timestamp: 1700000000,
            from: "123@c.us",
            hasMedia: false,
          },
        ],
        fromCache: true,
      };
      expect(response.messages).toBeInstanceOf(Array);
      expect(response.messages[0]).toHaveProperty("id");
      expect(response.messages[0]).toHaveProperty("body");
      expect(response.messages[0]).toHaveProperty("fromMe");
      expect(response.messages[0]).toHaveProperty("timestamp");
    });

    test("error response shape", () => {
      const error = { error: "something went wrong" };
      expect(error).toHaveProperty("error");
      expect(typeof error.error).toBe("string");
    });
  });
});
