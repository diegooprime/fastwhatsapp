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
