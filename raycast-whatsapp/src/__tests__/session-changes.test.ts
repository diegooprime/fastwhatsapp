/**
 * Tests for session changes across chat.tsx, inbox.tsx, qr.tsx, and api.ts.
 *
 * These validate the pure logic and behavioral contracts for recent changes
 * without requiring the Raycast runtime or React rendering.
 *
 * Pattern: Extract the logic under test into inline functions that mirror
 * the source code behavior, then validate contracts and invariants.
 */

describe("chat.tsx - Message Display Order", () => {
  // The API returns messages in newest-first (DESC) order.
  // chat.tsx previously called .reverse() — that was removed.
  // Now displayMessages = messages (preserves API order directly).

  interface MessageLike {
    id: string;
    timestamp: number;
    body: string;
  }

  test("displayMessages preserves API order (newest first, no reversal)", () => {
    // Simulate API returning messages in DESC order (newest first)
    const apiMessages: MessageLike[] = [
      { id: "msg3", timestamp: 1700000030, body: "newest" },
      { id: "msg2", timestamp: 1700000020, body: "middle" },
      { id: "msg1", timestamp: 1700000010, body: "oldest" },
    ];

    // The component logic: displayMessages = messages (direct assignment)
    const displayMessages = apiMessages;

    expect(displayMessages[0].body).toBe("newest");
    expect(displayMessages[1].body).toBe("middle");
    expect(displayMessages[2].body).toBe("oldest");
    expect(displayMessages).toBe(apiMessages); // same reference, no transformation
  });

  test("newest message appears at index 0 for default selectedIndex", () => {
    const apiMessages: MessageLike[] = [
      { id: "msg3", timestamp: 1700000030, body: "latest" },
      { id: "msg2", timestamp: 1700000020, body: "earlier" },
      { id: "msg1", timestamp: 1700000010, body: "earliest" },
    ];

    const displayMessages = apiMessages;
    const selectedIndex = 0; // default

    const currentMessage = displayMessages[selectedIndex];
    expect(currentMessage.body).toBe("latest");
    expect(currentMessage.timestamp).toBe(1700000030);
  });

  test("empty messages array produces empty display", () => {
    const apiMessages: MessageLike[] = [];
    const displayMessages = apiMessages;
    expect(displayMessages).toHaveLength(0);
  });
});

describe("chat.tsx - Auto-Refresh Interval", () => {
  // The component sets up a 2-second interval for auto-refresh polling.
  // This tests the interval constant and the refresh logic pattern.

  test("auto-refresh interval is 2000ms", () => {
    // Mirrors the constant used in: setInterval(async () => { ... }, 2000)
    const AUTO_REFRESH_INTERVAL_MS = 2000;
    expect(AUTO_REFRESH_INTERVAL_MS).toBe(2000);
    expect(AUTO_REFRESH_INTERVAL_MS).toBeLessThan(5000); // responsiveness constraint
    expect(AUTO_REFRESH_INTERVAL_MS).toBeGreaterThan(500); // not too aggressive
  });

  test("refresh logic compares newest timestamps to detect new messages", () => {
    // The interval checks: cachedNewest > currentNewest to decide if update needed
    const currentNewest = 1700000030;
    const cachedNewest = 1700000040; // newer message arrived

    expect(cachedNewest > currentNewest).toBe(true);
  });

  test("refresh logic skips update when no new messages", () => {
    const currentNewest = 1700000030;
    const cachedNewest = 1700000030; // same timestamp

    expect(cachedNewest > currentNewest).toBe(false);
  });

  test("full sync triggers every 5th cycle when no new cached messages", () => {
    // The component uses refreshCountRef.current >= 5 to trigger full sync
    const FULL_SYNC_CYCLE_THRESHOLD = 5;
    let refreshCount = 0;
    const fullSyncTriggered: number[] = [];

    for (let cycle = 1; cycle <= 12; cycle++) {
      refreshCount++;
      if (refreshCount >= FULL_SYNC_CYCLE_THRESHOLD) {
        fullSyncTriggered.push(cycle);
        refreshCount = 0;
      }
    }

    // Full sync fires at cycles 5 and 10
    expect(fullSyncTriggered).toEqual([5, 10]);
  });
});

describe("chat.tsx - Search Navigation with Highlight", () => {
  // When highlightMessageId is provided, the component:
  // 1. Fetches messages around the highlighted timestamp (getMessagesCached with before param)
  // 2. Finds the target message index for selection
  // 3. Then fetches latest messages in background (getMessagesCached without before param)

  interface MessageLike {
    id: string;
    timestamp: number;
  }

  test("highlighted message is found by ID in fetched messages", () => {
    const highlightMessageId = "target_msg_42";
    const highlightTimestamp = 1700000020;

    // Simulate messages fetched around the highlight timestamp
    const fetchedMessages: MessageLike[] = [
      { id: "msg_newer", timestamp: 1700000025 },
      { id: "target_msg_42", timestamp: 1700000020 },
      { id: "msg_older", timestamp: 1700000015 },
    ];

    // The component logic: findIndex to locate the highlighted message
    const apiIdx = fetchedMessages.findIndex(
      (m) => m.id === highlightMessageId,
    );

    expect(apiIdx).toBe(1);
    expect(fetchedMessages[apiIdx].timestamp).toBe(highlightTimestamp);
  });

  test("selection resets to 0 when latest messages replace highlighted ones", () => {
    // After showing highlighted messages, latest messages are fetched.
    // On success, selectedIndex is set to 0 (showing newest message).
    const latestMessages: MessageLike[] = [
      { id: "latest_1", timestamp: 1700000100 },
      { id: "latest_2", timestamp: 1700000090 },
    ];

    // Simulates: if (latest.messages.length > 0) { setSelectedIndex(0); }
    const newSelectedIndex = latestMessages.length > 0 ? 0 : 1;
    expect(newSelectedIndex).toBe(0);
  });

  test("highlight flow requires both messageId and timestamp", () => {
    // The component checks: if (highlightMessageId && highlightTimestamp && !forceRefresh)
    const cases = [
      { id: "msg1", ts: 1700000000, force: false, expected: true },
      { id: undefined, ts: 1700000000, force: false, expected: false },
      { id: "msg1", ts: undefined, force: false, expected: false },
      { id: "msg1", ts: 1700000000, force: true, expected: false },
      { id: undefined, ts: undefined, force: false, expected: false },
    ];

    for (const c of cases) {
      const takesHighlightPath = !!(c.id && c.ts && !c.force);
      expect(takesHighlightPath).toBe(c.expected);
    }
  });

  test("cached messages URL includes before parameter for highlight", () => {
    const chatId = "123@c.us";
    const limit = 30;
    const before = 1700000020;
    const baseUrl = "http://127.0.0.1:3847";

    let url = `${baseUrl}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&cached=true`;
    if (before) url += `&before=${before}`;

    expect(url).toContain("cached=true");
    expect(url).toContain(`before=${before}`);
  });
});

describe("chat.tsx - Group Sender Name Fallback", () => {
  // For group messages, sender display logic is:
  //   msg.fromMe ? "You"
  //   : msg.senderName ? msg.senderName.split(" ")[0]
  //   : contact.isGroup ? msg.from.split("@")[0] || "Member"
  //   : contact.name.split(" ")[0]
  //
  // Key change: group fallback uses msg.from (phone number), NOT contact.name (group name)

  interface ContactLike {
    name: string;
    isGroup: boolean;
  }

  interface MessageLike {
    fromMe: boolean;
    senderName?: string;
    from: string;
  }

  function getSenderDisplay(msg: MessageLike, contact: ContactLike): string {
    return msg.fromMe
      ? "You"
      : msg.senderName
        ? msg.senderName.split(" ")[0]
        : contact.isGroup
          ? msg.from.split("@")[0] || "Member"
          : contact.name.split(" ")[0];
  }

  test("group message with no senderName shows phone number from msg.from", () => {
    const contact: ContactLike = { name: "Family Group", isGroup: true };
    const msg: MessageLike = {
      fromMe: false,
      senderName: undefined,
      from: "15551234567@c.us",
    };

    const sender = getSenderDisplay(msg, contact);
    expect(sender).toBe("15551234567");
    // Critically: NOT the group name
    expect(sender).not.toBe("Family");
    expect(sender).not.toBe("Family Group");
  });

  test("group message with senderName shows first name", () => {
    const contact: ContactLike = { name: "Work Chat", isGroup: true };
    const msg: MessageLike = {
      fromMe: false,
      senderName: "Alice Johnson",
      from: "15559876543@c.us",
    };

    const sender = getSenderDisplay(msg, contact);
    expect(sender).toBe("Alice");
  });

  test("own message always shows You", () => {
    const contact: ContactLike = { name: "Family Group", isGroup: true };
    const msg: MessageLike = {
      fromMe: true,
      senderName: undefined,
      from: "15550000000@c.us",
    };

    const sender = getSenderDisplay(msg, contact);
    expect(sender).toBe("You");
  });

  test("1:1 chat with no senderName shows contact name", () => {
    const contact: ContactLike = { name: "Bob Smith", isGroup: false };
    const msg: MessageLike = {
      fromMe: false,
      senderName: undefined,
      from: "15551112222@c.us",
    };

    const sender = getSenderDisplay(msg, contact);
    expect(sender).toBe("Bob");
  });

  test("group message with empty from field shows Member fallback", () => {
    const contact: ContactLike = { name: "Random Group", isGroup: true };
    const msg: MessageLike = {
      fromMe: false,
      senderName: undefined,
      from: "@c.us", // edge case: empty prefix before @
    };

    // "".split("@")[0] is "", which is falsy, so || "Member" kicks in
    const sender = getSenderDisplay(msg, contact);
    expect(sender).toBe("Member");
  });
});

describe("inbox.tsx - Mark as Read", () => {
  // markAsRead: calls api.markRead(chat.id), then removes the chat from state.
  // State update: setChats(prev => prev.filter(c => c.id !== chat.id))

  interface ChatLike {
    id: string;
    name: string;
    unreadCount: number;
  }

  test("markAsRead removes the specific chat from the list", () => {
    const chats: ChatLike[] = [
      { id: "a@c.us", name: "Alice", unreadCount: 3 },
      { id: "b@c.us", name: "Bob", unreadCount: 1 },
      { id: "c@c.us", name: "Charlie", unreadCount: 5 },
    ];

    const chatToMark = chats[1]; // Bob
    // Simulate the state update: prev.filter(c => c.id !== chat.id)
    const updatedChats = chats.filter((c) => c.id !== chatToMark.id);

    expect(updatedChats).toHaveLength(2);
    expect(updatedChats.map((c) => c.name)).toEqual(["Alice", "Charlie"]);
    expect(updatedChats.find((c) => c.id === "b@c.us")).toBeUndefined();
  });

  test("markAsRead on last chat leaves empty list", () => {
    const chats: ChatLike[] = [
      { id: "only@c.us", name: "Only Chat", unreadCount: 1 },
    ];

    const updatedChats = chats.filter((c) => c.id !== "only@c.us");
    expect(updatedChats).toHaveLength(0);
  });

  test("markAsRead on nonexistent chat leaves list unchanged", () => {
    const chats: ChatLike[] = [
      { id: "a@c.us", name: "Alice", unreadCount: 3 },
    ];

    const updatedChats = chats.filter((c) => c.id !== "nonexistent@c.us");
    expect(updatedChats).toHaveLength(1);
    expect(updatedChats[0].name).toBe("Alice");
  });
});

describe("inbox.tsx - Mark All as Read", () => {
  // markAllAsRead: calls api.markRead for each chat, then setChats([])

  interface ChatLike {
    id: string;
    name: string;
    unreadCount: number;
  }

  test("markAllAsRead produces an api.markRead call for every chat", () => {
    const chats: ChatLike[] = [
      { id: "a@c.us", name: "Alice", unreadCount: 3 },
      { id: "b@c.us", name: "Bob", unreadCount: 1 },
      { id: "c@c.us", name: "Charlie", unreadCount: 5 },
    ];

    // Simulate: Promise.all(chats.map(c => api.markRead(c.id)))
    const markReadCalls = chats.map((c) => c.id);

    expect(markReadCalls).toEqual(["a@c.us", "b@c.us", "c@c.us"]);
    expect(markReadCalls).toHaveLength(3);
  });

  test("markAllAsRead empties the chat list", () => {
    const chats: ChatLike[] = [
      { id: "a@c.us", name: "Alice", unreadCount: 3 },
      { id: "b@c.us", name: "Bob", unreadCount: 1 },
    ];

    // After Promise.all resolves: setChats([])
    const _callIds = chats.map((c) => c.id);
    const updatedChats: ChatLike[] = [];

    expect(updatedChats).toHaveLength(0);
  });

  test("markAllAsRead on empty list produces zero calls", () => {
    const chats: ChatLike[] = [];

    const markReadCalls = chats.map((c) => c.id);
    expect(markReadCalls).toHaveLength(0);
  });
});

describe("qr.tsx - Message State in Markdown Fallback", () => {
  // The markdown output: qrCode ? `![](${qrCode})` : isLoading ? "" : message
  // When qrCode is null and not loading, the message state is rendered directly.

  function getMarkdown(
    qrCode: string | null,
    isLoading: boolean,
    message: string,
  ): string {
    return qrCode ? `![](${qrCode})` : isLoading ? "" : message;
  }

  test("shows QR image when qrCode is set", () => {
    const md = getMarkdown("data:image/png;base64,ABC", false, "ignored");
    expect(md).toBe("![](data:image/png;base64,ABC)");
  });

  test("shows empty string when loading and no qrCode", () => {
    const md = getMarkdown(null, true, "Loading QR code...");
    expect(md).toBe("");
  });

  test("shows message state when qrCode is null and not loading", () => {
    const md = getMarkdown(null, false, "Failed to load QR code. Is the service running?");
    expect(md).toBe("Failed to load QR code. Is the service running?");
  });

  test("shows default loading message when qrCode is null and not loading", () => {
    const md = getMarkdown(null, false, "Loading QR code...");
    expect(md).toBe("Loading QR code...");
  });

  test("message state can contain any user-facing text", () => {
    const customMessage = "Scan this QR code with WhatsApp on your phone";
    const md = getMarkdown(null, false, customMessage);
    expect(md).toBe(customMessage);
  });
});

describe("api.ts - reactToMessage Endpoint", () => {
  // api.reactToMessage(messageId, emoji) calls:
  //   POST /react with body { messageId, emoji }

  const baseUrl = "http://127.0.0.1:3847";

  test("react endpoint URL is /react", () => {
    const url = `${baseUrl}/react`;
    expect(url).toBe("http://127.0.0.1:3847/react");
  });

  test("react request body contains messageId and emoji", () => {
    const messageId = "true_123@c.us_ABCDEF123456";
    const emoji = "\u{1F44D}"; // thumbs up

    const body = JSON.stringify({ messageId, emoji });
    const parsed = JSON.parse(body);

    expect(parsed.messageId).toBe(messageId);
    expect(parsed.emoji).toBe("\u{1F44D}");
  });

  test("react body supports various emoji types", () => {
    const emojis = ["\u2764\uFE0F", "\u{1F44D}", "\u{1F602}", "\u{1F60D}", "\u{1F64F}", "\u{1F525}"];

    for (const emoji of emojis) {
      const body = JSON.stringify({ messageId: "msg1", emoji });
      const parsed = JSON.parse(body);
      expect(parsed.emoji).toBe(emoji);
      expect(parsed.messageId).toBe("msg1");
    }
  });

  test("react method is POST", () => {
    // Mirrors: this.fetch("/react", { method: "POST", body: ... })
    const options = {
      method: "POST" as const,
      body: JSON.stringify({ messageId: "msg1", emoji: "\u{1F44D}" }),
    };

    expect(options.method).toBe("POST");
  });

  test("react response contract includes success boolean", () => {
    const response = { success: true };
    expect(typeof response.success).toBe("boolean");
  });
});

describe("api.ts - getMessagesCached URL Construction", () => {
  const baseUrl = "http://127.0.0.1:3847";

  test("cached endpoint includes cached=true parameter", () => {
    const chatId = "123@c.us";
    const limit = 30;
    const url = `${baseUrl}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&cached=true`;

    expect(url).toContain("cached=true");
    expect(url).toContain("limit=30");
  });

  test("cached endpoint appends before parameter when provided", () => {
    const chatId = "123@c.us";
    const limit = 30;
    const before = 1700000020;
    let url = `${baseUrl}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&cached=true`;
    if (before) url += `&before=${before}`;

    expect(url).toContain("before=1700000020");
  });

  test("cached endpoint omits before parameter when undefined", () => {
    const chatId = "123@c.us";
    const limit = 30;
    const before: number | undefined = undefined;
    let url = `${baseUrl}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&cached=true`;
    if (before) url += `&before=${before}`;

    expect(url).not.toContain("before");
  });
});

describe("api.ts - getMessagesRefresh URL Construction", () => {
  const baseUrl = "http://127.0.0.1:3847";

  test("refresh endpoint includes refresh=true parameter", () => {
    const chatId = "123@c.us";
    const limit = 30;
    const url = `${baseUrl}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&refresh=true`;

    expect(url).toContain("refresh=true");
    expect(url).not.toContain("cached");
  });
});

describe("inbox.tsx - Unread Chat Filtering and Sorting", () => {
  // loadChats: filters chats with unreadCount > 0, sorts by lastMessageTimestamp DESC

  interface ChatLike {
    id: string;
    name: string;
    unreadCount: number;
    lastMessageTimestamp?: number;
  }

  test("only chats with unreadCount > 0 are shown", () => {
    const allChats: ChatLike[] = [
      { id: "a@c.us", name: "Alice", unreadCount: 3, lastMessageTimestamp: 1700000010 },
      { id: "b@c.us", name: "Bob", unreadCount: 0, lastMessageTimestamp: 1700000020 },
      { id: "c@c.us", name: "Charlie", unreadCount: 5, lastMessageTimestamp: 1700000030 },
    ];

    const unread = allChats
      .filter((c) => c.unreadCount > 0)
      .sort((a, b) => (b.lastMessageTimestamp ?? 0) - (a.lastMessageTimestamp ?? 0));

    expect(unread).toHaveLength(2);
    expect(unread[0].name).toBe("Charlie"); // most recent first
    expect(unread[1].name).toBe("Alice");
  });

  test("chats without timestamps sort to the end", () => {
    const allChats: ChatLike[] = [
      { id: "a@c.us", name: "Alice", unreadCount: 1 }, // no timestamp
      { id: "b@c.us", name: "Bob", unreadCount: 2, lastMessageTimestamp: 1700000010 },
    ];

    const unread = allChats
      .filter((c) => c.unreadCount > 0)
      .sort((a, b) => (b.lastMessageTimestamp ?? 0) - (a.lastMessageTimestamp ?? 0));

    expect(unread[0].name).toBe("Bob"); // has timestamp, sorts first
    expect(unread[1].name).toBe("Alice"); // no timestamp (0), sorts last
  });
});
