package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

// testSchema is the schema without FTS5 (which may not be compiled into the
// test-environment SQLite). All store logic except SearchMessages works without FTS.
const testSchema = `
CREATE TABLE IF NOT EXISTS contacts (
    jid TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    push_name TEXT NOT NULL DEFAULT '',
    number TEXT NOT NULL DEFAULT '',
    is_group INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chats (
    jid TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    is_group INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_message TEXT,
    last_msg_ts INTEGER,
    updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_jid TEXT NOT NULL,
    sender_jid TEXT NOT NULL DEFAULT '',
    sender_name TEXT NOT NULL DEFAULT '',
    from_me INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL DEFAULT '',
    timestamp INTEGER NOT NULL DEFAULT 0,
    has_media INTEGER NOT NULL DEFAULT 0,
    media_type TEXT,
    raw_proto BLOB
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_jid, timestamp DESC);
CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT
);
`

// newTestStore creates a temporary SQLite database for testing.
func newTestStore(t *testing.T) *AppStore {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	if _, err := db.Exec(testSchema); err != nil {
		t.Fatalf("run schema: %v", err)
	}
	t.Cleanup(func() {
		db.Close()
		os.Remove(dbPath)
	})
	return &AppStore{db: db}
}

func TestUpsertAndGetContacts(t *testing.T) {
	store := newTestStore(t)

	// Upsert a chat first (GetContacts queries chats table)
	err := store.UpsertChat("10000000001@s.whatsapp.net", "", false, nil, nil)
	if err != nil {
		t.Fatalf("UpsertChat: %v", err)
	}

	err = store.UpsertContact("10000000001@s.whatsapp.net", "TestUser", "D", "10000000001", false)
	if err != nil {
		t.Fatalf("UpsertContact: %v", err)
	}

	contacts, err := store.GetContacts()
	if err != nil {
		t.Fatalf("GetContacts: %v", err)
	}
	if len(contacts) != 1 {
		t.Fatalf("GetContacts: got %d, want 1", len(contacts))
	}
	if contacts[0].Name != "TestUser" {
		t.Errorf("contact name = %q, want %q", contacts[0].Name, "TestUser")
	}
	// Verify API format conversion
	if contacts[0].ID != "10000000001@c.us" {
		t.Errorf("contact ID = %q, want %q", contacts[0].ID, "10000000001@c.us")
	}
}

func TestUpsertContact_UpdateNonEmpty(t *testing.T) {
	store := newTestStore(t)

	store.UpsertChat("10000000001@s.whatsapp.net", "", false, nil, nil)
	store.UpsertContact("10000000001@s.whatsapp.net", "TestUser", "D", "10000000001", false)
	// Update with empty name should NOT overwrite
	store.UpsertContact("10000000001@s.whatsapp.net", "", "NewPush", "", false)

	contacts, _ := store.GetContacts()
	if len(contacts) != 1 {
		t.Fatalf("got %d contacts, want 1", len(contacts))
	}
	if contacts[0].Name != "TestUser" {
		t.Errorf("name should not be overwritten by empty: got %q", contacts[0].Name)
	}
}

func TestUpsertAndGetChats(t *testing.T) {
	store := newTestStore(t)

	msg := "hello there"
	ts := int64(1700000000)
	err := store.UpsertChat("10000000001@s.whatsapp.net", "TestUser", false, &msg, &ts)
	if err != nil {
		t.Fatalf("UpsertChat: %v", err)
	}

	chats, err := store.GetChats()
	if err != nil {
		t.Fatalf("GetChats: %v", err)
	}
	if len(chats) != 1 {
		t.Fatalf("got %d chats, want 1", len(chats))
	}
	if chats[0].Name != "TestUser" {
		t.Errorf("chat name = %q, want %q", chats[0].Name, "TestUser")
	}
	if chats[0].LastMessage == nil || *chats[0].LastMessage != "hello there" {
		t.Error("last message mismatch")
	}
}

func TestIncrementAndMarkRead(t *testing.T) {
	store := newTestStore(t)
	jid := "10000000001@s.whatsapp.net"
	store.UpsertChat(jid, "Test", false, nil, nil)

	store.IncrementUnread(jid)
	store.IncrementUnread(jid)

	chats, _ := store.GetChats()
	if len(chats) != 1 || chats[0].UnreadCount != 2 {
		t.Errorf("unread count = %d, want 2", chats[0].UnreadCount)
	}

	store.MarkRead(jid)
	chats, _ = store.GetChats()
	if chats[0].UnreadCount != 0 {
		t.Errorf("after MarkRead, unread = %d, want 0", chats[0].UnreadCount)
	}
}

func TestUpsertAndGetMessages(t *testing.T) {
	store := newTestStore(t)
	chatJID := "10000000001@s.whatsapp.net"

	err := store.UpsertMessage(
		"true_10000000001@c.us_MSG1",
		chatJID,
		chatJID,
		"TestUser",
		true,
		"hello",
		1700000001,
		false,
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("UpsertMessage: %v", err)
	}

	err = store.UpsertMessage(
		"false_10000000001@c.us_MSG2",
		chatJID,
		chatJID,
		"TestUser",
		false,
		"world",
		1700000002,
		false,
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("UpsertMessage 2: %v", err)
	}

	msgs, err := store.GetMessages(chatJID, 10, 0)
	if err != nil {
		t.Fatalf("GetMessages: %v", err)
	}
	if len(msgs) != 2 {
		t.Fatalf("got %d messages, want 2", len(msgs))
	}
	// Ordered by timestamp DESC
	if msgs[0].Body != "world" {
		t.Errorf("first message body = %q, want %q", msgs[0].Body, "world")
	}
}

func TestGetMessages_WithBeforeTs(t *testing.T) {
	store := newTestStore(t)
	chatJID := "10000000001@s.whatsapp.net"

	store.UpsertMessage("true_10000000001@c.us_MSG1", chatJID, chatJID, "", true, "old", 100, false, nil, nil)
	store.UpsertMessage("true_10000000001@c.us_MSG2", chatJID, chatJID, "", true, "new", 200, false, nil, nil)

	msgs, _ := store.GetMessages(chatJID, 10, 150)
	if len(msgs) != 1 {
		t.Fatalf("got %d messages with beforeTs=150, want 1", len(msgs))
	}
	if msgs[0].Body != "old" {
		t.Errorf("body = %q, want %q", msgs[0].Body, "old")
	}
}

func TestDeleteChat(t *testing.T) {
	store := newTestStore(t)
	chatJID := "10000000001@s.whatsapp.net"
	store.UpsertChat(chatJID, "Test", false, nil, nil)
	store.UpsertMessage("true_10000000001@c.us_MSG1", chatJID, chatJID, "", true, "msg", 100, false, nil, nil)

	err := store.DeleteChat(chatJID)
	if err != nil {
		t.Fatalf("DeleteChat: %v", err)
	}

	chats, _ := store.GetChats()
	if len(chats) != 0 {
		t.Errorf("chat still exists after delete")
	}
	msgs, _ := store.GetMessages(chatJID, 10, 0)
	if len(msgs) != 0 {
		t.Errorf("messages still exist after delete")
	}
}

func TestGetMessageCount(t *testing.T) {
	store := newTestStore(t)
	chatJID := "10000000001@s.whatsapp.net"

	count, _ := store.GetMessageCount(chatJID)
	if count != 0 {
		t.Errorf("empty chat count = %d", count)
	}

	store.UpsertMessage("true_10000000001@c.us_MSG1", chatJID, chatJID, "", true, "a", 100, false, nil, nil)
	store.UpsertMessage("true_10000000001@c.us_MSG2", chatJID, chatJID, "", true, "b", 200, false, nil, nil)

	count, _ = store.GetMessageCount(chatJID)
	if count != 2 {
		t.Errorf("count = %d, want 2", count)
	}
}

// ---------------------------------------------------------------------------
// GetContactName
// ---------------------------------------------------------------------------

func TestGetContactName_ReturnsName(t *testing.T) {
	store := newTestStore(t)
	store.UpsertContact("10000000001@s.whatsapp.net", "Alice Smith", "Ali", "10000000001", false)

	name, err := store.GetContactName("10000000001@s.whatsapp.net")
	if err != nil {
		t.Fatalf("GetContactName: %v", err)
	}
	if name != "Alice Smith" {
		t.Errorf("GetContactName = %q, want %q", name, "Alice Smith")
	}
}

func TestGetContactName_FallbackToPushName(t *testing.T) {
	store := newTestStore(t)
	// Insert a contact with empty name but valid push_name
	store.UpsertContact("10000000002@s.whatsapp.net", "", "PushAlice", "10000000002", false)

	name, err := store.GetContactName("10000000002@s.whatsapp.net")
	if err != nil {
		t.Fatalf("GetContactName: %v", err)
	}
	if name != "PushAlice" {
		t.Errorf("GetContactName = %q, want %q", name, "PushAlice")
	}
}

func TestGetContactName_NotFound(t *testing.T) {
	store := newTestStore(t)

	_, err := store.GetContactName("99999999999@s.whatsapp.net")
	if err == nil {
		t.Error("GetContactName should return error for missing contact")
	}
}

// ---------------------------------------------------------------------------
// GetContacts includes groups
// ---------------------------------------------------------------------------

func TestGetContacts_IncludesGroups(t *testing.T) {
	store := newTestStore(t)

	// Insert an individual chat
	store.UpsertChat("10000000001@s.whatsapp.net", "Alice", false, nil, nil)
	store.UpsertContact("10000000001@s.whatsapp.net", "Alice Smith", "", "10000000001", false)

	// Insert a group chat
	store.UpsertChat("120363000000000001@g.us", "Family Group", true, nil, nil)

	contacts, err := store.GetContacts()
	if err != nil {
		t.Fatalf("GetContacts: %v", err)
	}
	if len(contacts) != 2 {
		t.Fatalf("GetContacts: got %d, want 2", len(contacts))
	}

	// Find each by their API JID and verify isGroup flags
	var foundIndividual, foundGroup bool
	for _, c := range contacts {
		if c.ID == "10000000001@c.us" {
			foundIndividual = true
			if c.IsGroup {
				t.Error("individual contact should have IsGroup=false")
			}
			if c.Name != "Alice Smith" {
				t.Errorf("individual name = %q, want %q", c.Name, "Alice Smith")
			}
		}
		if c.ID == "120363000000000001@g.us" {
			foundGroup = true
			if !c.IsGroup {
				t.Error("group contact should have IsGroup=true")
			}
			if c.Name != "Family Group" {
				t.Errorf("group name = %q, want %q", c.Name, "Family Group")
			}
		}
	}
	if !foundIndividual {
		t.Error("individual contact not found in GetContacts results")
	}
	if !foundGroup {
		t.Error("group contact not found in GetContacts results")
	}
}

func TestGetContacts_ExcludesLidAndBroadcast(t *testing.T) {
	store := newTestStore(t)

	store.UpsertChat("10000000001@s.whatsapp.net", "Alice", false, nil, nil)
	store.UpsertChat("1234@lid", "LID User", false, nil, nil)
	store.UpsertChat("status@broadcast", "Status", false, nil, nil)

	contacts, err := store.GetContacts()
	if err != nil {
		t.Fatalf("GetContacts: %v", err)
	}
	if len(contacts) != 1 {
		t.Fatalf("GetContacts: got %d, want 1 (should exclude @lid and @broadcast)", len(contacts))
	}
	if contacts[0].ID != "10000000001@c.us" {
		t.Errorf("unexpected contact ID %q", contacts[0].ID)
	}
}

// ---------------------------------------------------------------------------
// GetMessages name resolution via SQL
// ---------------------------------------------------------------------------

func TestGetMessages_ResolvesContactName(t *testing.T) {
	store := newTestStore(t)
	chatJID := "120363000000000001@g.us"
	senderJID := "10000000099@s.whatsapp.net"

	// Insert a contact with a proper name
	store.UpsertContact(senderJID, "Bob Johnson", "", "10000000099", false)

	// Insert a message from that sender
	store.UpsertMessage(
		"false_120363000000000001@g.us_MSG1",
		chatJID, senderJID, "", false,
		"hello from bob", 1700000001, false, nil, nil,
	)

	msgs, err := store.GetMessages(chatJID, 10, 0)
	if err != nil {
		t.Fatalf("GetMessages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("got %d messages, want 1", len(msgs))
	}
	if msgs[0].SenderName == nil {
		t.Fatal("SenderName is nil, expected contact name resolution")
	}
	if *msgs[0].SenderName != "Bob Johnson" {
		t.Errorf("SenderName = %q, want %q", *msgs[0].SenderName, "Bob Johnson")
	}
}

func TestGetMessages_PushNameFallbackToContactName(t *testing.T) {
	store := newTestStore(t)
	chatJID := "120363000000000001@g.us"
	senderJID := "10000000088@s.whatsapp.net"

	// A contact where push_name is ":)" but name is the real name "Bucanero"
	store.UpsertContact(senderJID, "Bucanero", ":)", "10000000088", false)

	// Message with sender_name ":)" (the push name) -- the SQL should resolve
	// via the direct JID match to "Bucanero" (the contact name)
	store.UpsertMessage(
		"false_120363000000000001@g.us_MSG2",
		chatJID, senderJID, ":)", false,
		"hola", 1700000002, false, nil, nil,
	)

	msgs, err := store.GetMessages(chatJID, 10, 0)
	if err != nil {
		t.Fatalf("GetMessages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("got %d messages, want 1", len(msgs))
	}
	if msgs[0].SenderName == nil {
		t.Fatal("SenderName is nil")
	}
	if *msgs[0].SenderName != "Bucanero" {
		t.Errorf("SenderName = %q, want %q (should resolve push_name to contact name)", *msgs[0].SenderName, "Bucanero")
	}
}

func TestGetMessages_PushNameFallbackViaSubquery(t *testing.T) {
	store := newTestStore(t)
	chatJID := "120363000000000001@g.us"
	senderJID := "10000000077@s.whatsapp.net"

	// Contact has no direct JID match, but push_name matches a contact row
	// This tests the "(SELECT c2.name FROM contacts c2 WHERE c2.push_name = m.sender_name)" fallback
	store.UpsertContact("10000000077@s.whatsapp.net", "Real Name", "NickPush", "10000000077", false)

	// Message whose sender_name is "NickPush" but sender_jid matches the contact
	store.UpsertMessage(
		"false_120363000000000001@g.us_MSG3",
		chatJID, senderJID, "NickPush", false,
		"test push fallback", 1700000003, false, nil, nil,
	)

	msgs, err := store.GetMessages(chatJID, 10, 0)
	if err != nil {
		t.Fatalf("GetMessages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("got %d messages, want 1", len(msgs))
	}
	if msgs[0].SenderName == nil {
		t.Fatal("SenderName is nil")
	}
	// Direct JID match finds "Real Name" first
	if *msgs[0].SenderName != "Real Name" {
		t.Errorf("SenderName = %q, want %q", *msgs[0].SenderName, "Real Name")
	}
}

// ---------------------------------------------------------------------------
// GetMessages sender name fallback from other messages with same sender_jid
// ---------------------------------------------------------------------------

func TestGetMessages_FallbackFromOtherMessages(t *testing.T) {
	store := newTestStore(t)
	chatJID := "120363000000000001@g.us"
	senderJID := "10000000066@s.whatsapp.net"

	// No contact entry for this sender. Two messages: one with a name, one without.
	store.UpsertMessage(
		"false_120363000000000001@g.us_MSG_WITH_NAME",
		chatJID, senderJID, "Charlie", false,
		"I have a name", 1700000010, false, nil, nil,
	)
	store.UpsertMessage(
		"false_120363000000000001@g.us_MSG_NO_NAME",
		chatJID, senderJID, "", false,
		"I have no name", 1700000011, false, nil, nil,
	)

	msgs, err := store.GetMessages(chatJID, 10, 0)
	if err != nil {
		t.Fatalf("GetMessages: %v", err)
	}
	if len(msgs) != 2 {
		t.Fatalf("got %d messages, want 2", len(msgs))
	}

	// Both messages should resolve to "Charlie" via the message-based fallback
	for _, m := range msgs {
		if m.SenderName == nil {
			t.Errorf("message %q has nil SenderName, expected %q", m.ID, "Charlie")
			continue
		}
		if *m.SenderName != "Charlie" {
			t.Errorf("message %q SenderName = %q, want %q", m.ID, *m.SenderName, "Charlie")
		}
	}
}

// ---------------------------------------------------------------------------
// UpsertMessage for sent text (simulates handleSend DB storage)
// ---------------------------------------------------------------------------

func TestUpsertMessage_SentTextStoredInDB(t *testing.T) {
	store := newTestStore(t)
	chatJID := "10000000001@s.whatsapp.net"
	senderJID := "10000000099@s.whatsapp.net"
	msgID := "true_10000000001@c.us_SENT_MSG_1"
	body := "Hello, this is a sent message"
	now := int64(1700000100)

	// Simulate what handleSend does after successful send
	err := store.UpsertMessage(
		msgID, chatJID, senderJID, "", true,
		body, now, false, nil, nil,
	)
	if err != nil {
		t.Fatalf("UpsertMessage: %v", err)
	}

	// Verify the message is stored
	msgs, err := store.GetMessages(chatJID, 10, 0)
	if err != nil {
		t.Fatalf("GetMessages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("got %d messages, want 1", len(msgs))
	}
	if msgs[0].ID != msgID {
		t.Errorf("message ID = %q, want %q", msgs[0].ID, msgID)
	}
	if msgs[0].Body != body {
		t.Errorf("message body = %q, want %q", msgs[0].Body, body)
	}
	if !msgs[0].FromMe {
		t.Error("message fromMe should be true")
	}
	if msgs[0].Timestamp != now {
		t.Errorf("timestamp = %d, want %d", msgs[0].Timestamp, now)
	}
	if msgs[0].HasMedia {
		t.Error("sent text message should not have media")
	}
}

// ---------------------------------------------------------------------------
// UpsertMessage for sent image (simulates handleSendImage DB storage)
// ---------------------------------------------------------------------------

func TestUpsertMessage_SentImageStoredInDB(t *testing.T) {
	store := newTestStore(t)
	chatJID := "10000000001@s.whatsapp.net"
	senderJID := "10000000099@s.whatsapp.net"
	msgID := "true_10000000001@c.us_SENT_IMG_1"
	caption := "Check this out"
	now := int64(1700000200)
	mediaType := "image"

	// Simulate what handleSendImage does after successful send
	err := store.UpsertMessage(
		msgID, chatJID, senderJID, "", true,
		caption, now, true, &mediaType, nil,
	)
	if err != nil {
		t.Fatalf("UpsertMessage: %v", err)
	}

	// Verify the message is stored with correct media fields
	msgs, err := store.GetMessages(chatJID, 10, 0)
	if err != nil {
		t.Fatalf("GetMessages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("got %d messages, want 1", len(msgs))
	}
	if msgs[0].ID != msgID {
		t.Errorf("message ID = %q, want %q", msgs[0].ID, msgID)
	}
	if msgs[0].Body != caption {
		t.Errorf("body (caption) = %q, want %q", msgs[0].Body, caption)
	}
	if !msgs[0].FromMe {
		t.Error("sent image fromMe should be true")
	}
	if !msgs[0].HasMedia {
		t.Error("sent image should have has_media=true")
	}
	if msgs[0].MediaType == nil {
		t.Fatal("sent image media_type should not be nil")
	}
	if *msgs[0].MediaType != "image" {
		t.Errorf("media_type = %q, want %q", *msgs[0].MediaType, "image")
	}
}

func TestUpsertMessage_SentImageNoCaption(t *testing.T) {
	store := newTestStore(t)
	chatJID := "10000000001@s.whatsapp.net"
	senderJID := "10000000099@s.whatsapp.net"
	msgID := "true_10000000001@c.us_SENT_IMG_2"
	now := int64(1700000300)
	mediaType := "image"

	// Image without caption - body is empty string
	err := store.UpsertMessage(
		msgID, chatJID, senderJID, "", true,
		"", now, true, &mediaType, nil,
	)
	if err != nil {
		t.Fatalf("UpsertMessage: %v", err)
	}

	msgs, err := store.GetMessages(chatJID, 10, 0)
	if err != nil {
		t.Fatalf("GetMessages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("got %d messages, want 1", len(msgs))
	}
	if msgs[0].Body != "" {
		t.Errorf("body should be empty for captionless image, got %q", msgs[0].Body)
	}
	if !msgs[0].HasMedia {
		t.Error("captionless image should still have has_media=true")
	}
}

// ---------------------------------------------------------------------------
// UpdateChatLastMessage (used by handleSend after storing message)
// ---------------------------------------------------------------------------

func TestUpdateChatLastMessage(t *testing.T) {
	store := newTestStore(t)
	chatJID := "10000000001@s.whatsapp.net"
	store.UpsertChat(chatJID, "Test", false, nil, nil)

	err := store.UpdateChatLastMessage(chatJID, "latest msg", 1700000500)
	if err != nil {
		t.Fatalf("UpdateChatLastMessage: %v", err)
	}

	chats, err := store.GetChats()
	if err != nil {
		t.Fatalf("GetChats: %v", err)
	}
	if len(chats) != 1 {
		t.Fatalf("got %d chats, want 1", len(chats))
	}
	if chats[0].LastMessage == nil || *chats[0].LastMessage != "latest msg" {
		t.Errorf("last message mismatch: got %v", chats[0].LastMessage)
	}
	if chats[0].LastMessageTimestamp == nil || *chats[0].LastMessageTimestamp != 1700000500 {
		t.Errorf("last message timestamp mismatch: got %v", chats[0].LastMessageTimestamp)
	}
}

// NOTE: SearchMessages requires FTS5 which may not be available in all
// SQLite builds. SearchMessages is tested via integration tests with the
// full bridge binary that includes FTS5 support.

func TestGetRawProto(t *testing.T) {
	store := newTestStore(t)
	chatJID := "10000000001@s.whatsapp.net"
	proto := []byte{0x0a, 0x0b, 0x0c}

	store.UpsertMessage("true_10000000001@c.us_MSG1", chatJID, chatJID, "", true, "img", 100, true, strPtr("image"), proto)

	raw, err := store.GetRawProto("true_10000000001@c.us_MSG1")
	if err != nil {
		t.Fatalf("GetRawProto: %v", err)
	}
	if len(raw) != 3 || raw[0] != 0x0a {
		t.Errorf("raw proto mismatch: %v", raw)
	}
}

func TestGetOldestMessage(t *testing.T) {
	store := newTestStore(t)
	chatJID := "10000000001@s.whatsapp.net"

	store.UpsertMessage("true_10000000001@c.us_MSG1", chatJID, chatJID, "", true, "older", 100, false, nil, nil)
	store.UpsertMessage("true_10000000001@c.us_MSG2", chatJID, chatJID, "", true, "newer", 200, false, nil, nil)

	oldest, err := store.GetOldestMessage(chatJID)
	if err != nil {
		t.Fatalf("GetOldestMessage: %v", err)
	}
	if oldest.Ts != 100 {
		t.Errorf("oldest ts = %d, want 100", oldest.Ts)
	}
	if oldest.RawMsgID != "MSG1" {
		t.Errorf("oldest rawMsgID = %q, want %q", oldest.RawMsgID, "MSG1")
	}
}
