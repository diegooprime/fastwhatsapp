package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// AppStore is the SQLite data access layer for the WhatsApp bridge.
type AppStore struct {
	db *sql.DB
}

// boolToInt converts a Go bool to an integer for SQLite storage.
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// NewAppStore opens the database at ~/.whatsapp-raycast/app.db, enables WAL mode
// with a 5000ms busy timeout, and runs schema migrations.
func NewAppStore() (*AppStore, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("get home dir: %w", err)
	}

	dir := filepath.Join(home, ".whatsapp-raycast")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	dbPath := filepath.Join(dir, "app.db")
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	if _, err := db.Exec(appSchema); err != nil {
		db.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	// One-time FTS population: rebuild index if FTS is empty but messages exist.
	// Using 'rebuild' is the correct way to populate a content= FTS5 table.
	var ftsCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM messages_fts`).Scan(&ftsCount); err == nil && ftsCount == 0 {
		var msgCount int
		if err := db.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&msgCount); err == nil && msgCount > 0 {
			if _, err := db.Exec(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`); err != nil {
				log.Printf("FTS rebuild failed: %v", err)
			} else {
				log.Printf("FTS rebuild: indexed %d messages", msgCount)
			}
		}
	}

	return &AppStore{db: db}, nil
}

// Close closes the underlying database connection.
func (s *AppStore) Close() error {
	return s.db.Close()
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

// UpsertContact inserts a contact or updates non-empty fields on conflict.
func (s *AppStore) UpsertContact(jid, name, pushName, number string, isGroup bool) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`
		INSERT INTO contacts (jid, name, push_name, number, is_group, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(jid) DO UPDATE SET
			name      = CASE WHEN excluded.name      != '' THEN excluded.name      ELSE contacts.name      END,
			push_name = CASE WHEN excluded.push_name  != '' THEN excluded.push_name  ELSE contacts.push_name  END,
			number    = CASE WHEN excluded.number     != '' THEN excluded.number     ELSE contacts.number     END,
			is_group  = excluded.is_group,
			updated_at = excluded.updated_at
	`, jid, name, pushName, number, boolToInt(isGroup), now)
	if err != nil {
		return fmt.Errorf("upsert contact %s: %w", jid, err)
	}
	return nil
}

// UpdatePushName updates only the push_name field for an existing contact.
func (s *AppStore) UpdatePushName(jid, pushName string) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`
		INSERT INTO contacts (jid, push_name, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(jid) DO UPDATE SET
			push_name  = CASE WHEN excluded.push_name != '' THEN excluded.push_name ELSE contacts.push_name END,
			updated_at = excluded.updated_at
	`, jid, pushName, now)
	if err != nil {
		return fmt.Errorf("update push_name %s: %w", jid, err)
	}
	return nil
}

// GetContacts returns all contacts sorted by display name.
// Display name precedence: name, then push_name, then number.
// JIDs are returned in API format via toAPIJIDString.
func (s *AppStore) GetContacts() ([]Contact, error) {
	// Query non-group chats LEFT JOIN contacts to return all known individuals.
	// This ensures contacts appear even if the contacts table has no entry yet
	// (whatsmeow doesn't always provide display names from HistorySync).
	rows, err := s.db.Query(`
		SELECT ch.jid,
			COALESCE(NULLIF(ct.name, ''), NULLIF(ct.push_name, ''), NULLIF(ch.name, ''),
				REPLACE(REPLACE(ch.jid, '@s.whatsapp.net', ''), '@c.us', '')) AS display_name,
			COALESCE(NULLIF(ct.number, ''),
				REPLACE(REPLACE(ch.jid, '@s.whatsapp.net', ''), '@c.us', '')) AS number,
			ch.is_group
		FROM chats ch
		LEFT JOIN contacts ct ON ch.jid = ct.jid
		WHERE ch.is_group = 0
			AND ch.jid NOT LIKE '%@lid'
			AND ch.jid NOT LIKE '%@broadcast'
		ORDER BY display_name COLLATE NOCASE ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query contacts: %w", err)
	}
	defer rows.Close()

	contacts := make([]Contact, 0)
	for rows.Next() {
		var jid, displayName, number string
		var isGroup int
		if err := rows.Scan(&jid, &displayName, &number, &isGroup); err != nil {
			return nil, fmt.Errorf("scan contact: %w", err)
		}

		contacts = append(contacts, Contact{
			ID:      toAPIJIDString(jid),
			Name:    displayName,
			Number:  number,
			IsGroup: isGroup != 0,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate contacts: %w", err)
	}
	return contacts, nil
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

// UpsertChat inserts a chat or updates fields on conflict. Name is updated only
// if the incoming value is non-empty. last_message and last_msg_ts are updated
// only if the incoming timestamp is newer than the existing one.
func (s *AppStore) UpsertChat(jid, name string, isGroup bool, lastMsg *string, lastMsgTs *int64) error {
	now := time.Now().Unix()
	_, err := s.db.Exec(`
		INSERT INTO chats (jid, name, is_group, last_message, last_msg_ts, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(jid) DO UPDATE SET
			name         = CASE WHEN excluded.name != '' THEN excluded.name ELSE chats.name END,
			is_group     = excluded.is_group,
			last_message = CASE
				WHEN excluded.last_msg_ts IS NOT NULL AND (chats.last_msg_ts IS NULL OR excluded.last_msg_ts > chats.last_msg_ts)
				THEN excluded.last_message
				ELSE chats.last_message
			END,
			last_msg_ts  = CASE
				WHEN excluded.last_msg_ts IS NOT NULL AND (chats.last_msg_ts IS NULL OR excluded.last_msg_ts > chats.last_msg_ts)
				THEN excluded.last_msg_ts
				ELSE chats.last_msg_ts
			END,
			updated_at   = excluded.updated_at
	`, jid, name, boolToInt(isGroup), lastMsg, lastMsgTs, now)
	if err != nil {
		return fmt.Errorf("upsert chat %s: %w", jid, err)
	}
	return nil
}

// GetChats returns all chats ordered by last_msg_ts descending.
// JIDs are returned in API format.
func (s *AppStore) GetChats() ([]Chat, error) {
	rows, err := s.db.Query(`
		SELECT ch.jid,
			COALESCE(NULLIF(ch.name, ''), NULLIF(ct.push_name, ''), NULLIF(ct.name, ''),
				REPLACE(REPLACE(ch.jid, '@s.whatsapp.net', ''), '@g.us', '')) AS display_name,
			ch.is_group, ch.unread_count, ch.last_message, ch.last_msg_ts,
			(SELECT COUNT(*) FROM messages m WHERE m.chat_jid = ch.jid) AS msg_count
		FROM chats ch
		LEFT JOIN contacts ct ON ch.jid = ct.jid
		WHERE ch.jid NOT LIKE '%@lid'
			AND ch.jid NOT LIKE '%@broadcast'
		ORDER BY COALESCE(ch.last_msg_ts, 0) DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("query chats: %w", err)
	}
	defer rows.Close()

	chats := make([]Chat, 0)
	for rows.Next() {
		var jid, name string
		var isGroup, unreadCount, msgCount int
		var lastMessage *string
		var lastMsgTs *int64
		if err := rows.Scan(&jid, &name, &isGroup, &unreadCount, &lastMessage, &lastMsgTs, &msgCount); err != nil {
			return nil, fmt.Errorf("scan chat: %w", err)
		}

		chats = append(chats, Chat{
			ID:                  toAPIJIDString(jid),
			Name:                name,
			IsGroup:             isGroup != 0,
			UnreadCount:         unreadCount,
			LastMessage:         lastMessage,
			LastMessageTimestamp: lastMsgTs,
			MessageCount:        msgCount,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate chats: %w", err)
	}
	return chats, nil
}

// IncrementUnread increments the unread count for a chat by one.
func (s *AppStore) IncrementUnread(chatJID string) error {
	_, err := s.db.Exec(`
		UPDATE chats SET unread_count = unread_count + 1, updated_at = ? WHERE jid = ?
	`, time.Now().Unix(), chatJID)
	if err != nil {
		return fmt.Errorf("increment unread %s: %w", chatJID, err)
	}
	return nil
}

// SetUnread sets the unread count for a chat to a specific value.
func (s *AppStore) SetUnread(chatJID string, count int) error {
	_, err := s.db.Exec(`
		UPDATE chats SET unread_count = ?, updated_at = ? WHERE jid = ?
	`, count, time.Now().Unix(), chatJID)
	if err != nil {
		return fmt.Errorf("set unread %s: %w", chatJID, err)
	}
	return nil
}

// MarkRead resets the unread count for a chat to zero.
func (s *AppStore) MarkRead(chatJID string) error {
	_, err := s.db.Exec(`
		UPDATE chats SET unread_count = 0, updated_at = ? WHERE jid = ?
	`, time.Now().Unix(), chatJID)
	if err != nil {
		return fmt.Errorf("mark read %s: %w", chatJID, err)
	}
	return nil
}

// DeleteChat removes a chat and all its messages in a single transaction.
func (s *AppStore) DeleteChat(chatJID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM messages WHERE chat_jid = ?`, chatJID); err != nil {
		return fmt.Errorf("delete messages for %s: %w", chatJID, err)
	}
	if _, err := tx.Exec(`DELETE FROM chats WHERE jid = ?`, chatJID); err != nil {
		return fmt.Errorf("delete chat %s: %w", chatJID, err)
	}

	return tx.Commit()
}

// UpdateChatLastMessage updates the last message preview and timestamp for a chat.
func (s *AppStore) UpdateChatLastMessage(chatJID, body string, timestamp int64) error {
	_, err := s.db.Exec(`
		UPDATE chats SET last_message = ?, last_msg_ts = ?, updated_at = ? WHERE jid = ?
	`, body, timestamp, time.Now().Unix(), chatJID)
	if err != nil {
		return fmt.Errorf("update chat last message %s: %w", chatJID, err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

// UpsertMessage inserts a message or updates select fields on conflict.
// Body and sender_name are updated only if the new value is non-empty.
// Media fields are always updated on conflict.
func (s *AppStore) UpsertMessage(id, chatJID, senderJID, senderName string, fromMe bool, body string, timestamp int64, hasMedia bool, mediaType *string, rawProto []byte) error {
	_, err := s.db.Exec(`
		INSERT INTO messages (id, chat_jid, sender_jid, sender_name, from_me, body, timestamp, has_media, media_type, raw_proto)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			body        = CASE WHEN excluded.body        != '' THEN excluded.body        ELSE messages.body        END,
			sender_name = CASE WHEN excluded.sender_name != '' THEN excluded.sender_name ELSE messages.sender_name END,
			has_media   = excluded.has_media,
			media_type  = excluded.media_type,
			raw_proto   = excluded.raw_proto
	`, id, chatJID, senderJID, senderName, boolToInt(fromMe), body, timestamp, boolToInt(hasMedia), mediaType, rawProto)
	if err != nil {
		return fmt.Errorf("upsert message %s: %w", id, err)
	}
	return nil
}

// GetMessages returns messages for a chat ordered by timestamp descending, limited to n.
// If beforeTs > 0, only returns messages with timestamp <= beforeTs.
// The From field is the sender JID in API format. SenderName is set only if non-empty.
func (s *AppStore) GetMessages(chatJID string, limit int, beforeTs int64) ([]Message, error) {
	var rows *sql.Rows
	var err error
	if beforeTs > 0 {
		rows, err = s.db.Query(`
			SELECT id, sender_jid, sender_name, from_me, body, timestamp, has_media, media_type
			FROM messages
			WHERE chat_jid = ? AND timestamp <= ?
			ORDER BY timestamp DESC
			LIMIT ?
		`, chatJID, beforeTs, limit)
	} else {
		rows, err = s.db.Query(`
			SELECT id, sender_jid, sender_name, from_me, body, timestamp, has_media, media_type
			FROM messages
			WHERE chat_jid = ?
			ORDER BY timestamp DESC
			LIMIT ?
		`, chatJID, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("query messages for %s: %w", chatJID, err)
	}
	defer rows.Close()

	messages := make([]Message, 0)
	for rows.Next() {
		var id, senderJID, senderName, body string
		var fromMe, hasMedia int
		var ts int64
		var mediaType *string
		if err := rows.Scan(&id, &senderJID, &senderName, &fromMe, &body, &ts, &hasMedia, &mediaType); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}

		msg := Message{
			ID:        id,
			Body:      body,
			FromMe:    fromMe != 0,
			Timestamp: ts,
			From:      toAPIJIDString(senderJID),
			HasMedia:  hasMedia != 0,
			MediaType: mediaType,
		}

		if senderName != "" {
			sn := senderName
			msg.SenderName = &sn
		}

		messages = append(messages, msg)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate messages: %w", err)
	}
	return messages, nil
}

// GetRawProto returns the stored raw protobuf bytes for a message.
func (s *AppStore) GetRawProto(messageID string) ([]byte, error) {
	var rawProto []byte
	err := s.db.QueryRow(`SELECT raw_proto FROM messages WHERE id = ?`, messageID).Scan(&rawProto)
	if err != nil {
		return nil, fmt.Errorf("get raw proto %s: %w", messageID, err)
	}
	return rawProto, nil
}

// GetLatestMessageID returns the formatted message ID of the most recent message
// in a chat. The ID is formatted via formatMessageID for API compatibility.
func (s *AppStore) GetLatestMessageID(chatJID string) (string, error) {
	var id string
	err := s.db.QueryRow(`
		SELECT id FROM messages
		WHERE chat_jid = ?
		ORDER BY timestamp DESC
		LIMIT 1
	`, chatJID).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("get latest message id for %s: %w", chatJID, err)
	}
	return id, nil
}

// OldestMessageInfo holds the data needed to build an on-demand history sync request.
type OldestMessageInfo struct {
	RawMsgID string
	ChatJID  string
	FromMe   bool
	Ts       int64
}

// GetOldestMessage returns the oldest message in a chat for use as an anchor in
// on-demand history sync requests.
func (s *AppStore) GetOldestMessage(chatJID string) (*OldestMessageInfo, error) {
	var id string
	var fromMe int
	var ts int64
	err := s.db.QueryRow(`
		SELECT id, from_me, timestamp FROM messages
		WHERE chat_jid = ?
		ORDER BY timestamp ASC
		LIMIT 1
	`, chatJID).Scan(&id, &fromMe, &ts)
	if err != nil {
		return nil, fmt.Errorf("get oldest message for %s: %w", chatJID, err)
	}
	parts := parseMessageIDParts(id)
	if parts == nil {
		return nil, fmt.Errorf("failed to parse message id: %s", id)
	}
	return &OldestMessageInfo{
		RawMsgID: parts.messageID,
		ChatJID:  chatJID,
		FromMe:   fromMe != 0,
		Ts:       ts,
	}, nil
}

// GetAllChatJIDs returns all chat JIDs.
func (s *AppStore) GetAllChatJIDs() ([]string, error) {
	rows, err := s.db.Query(`SELECT jid FROM chats WHERE jid NOT LIKE '%@lid' AND jid NOT LIKE '%@broadcast'`)
	if err != nil {
		return nil, fmt.Errorf("query chat jids: %w", err)
	}
	defer rows.Close()
	var jids []string
	for rows.Next() {
		var jid string
		rows.Scan(&jid)
		jids = append(jids, jid)
	}
	return jids, nil
}

// GetMessageCount returns the number of messages in a chat.
func (s *AppStore) GetMessageCount(chatJID string) (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM messages WHERE chat_jid = ?`, chatJID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count messages for %s: %w", chatJID, err)
	}
	return count, nil
}

// GetTotalMessageCount returns the total number of messages across all chats.
func (s *AppStore) GetTotalMessageCount() (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count total messages: %w", err)
	}
	return count, nil
}

// SearchMessages performs full-text search across all messages using the FTS5 index.
// Results are joined with chats/contacts to include chat display name and JID,
// and ordered by FTS5 relevance rank.
func (s *AppStore) SearchMessages(query string, limit int) ([]SearchResult, error) {
	rows, err := s.db.Query(`
		SELECT m.id, m.sender_jid, m.sender_name, m.from_me, m.body, m.timestamp,
			m.has_media, m.media_type, m.chat_jid,
			COALESCE(NULLIF(ch.name, ''), NULLIF(ct.push_name, ''), NULLIF(ct.name, ''),
				REPLACE(REPLACE(m.chat_jid, '@s.whatsapp.net', ''), '@g.us', '')) AS chat_name
		FROM messages_fts fts
		JOIN messages m ON m.rowid = fts.rowid
		LEFT JOIN chats ch ON ch.jid = m.chat_jid
		LEFT JOIN contacts ct ON ct.jid = m.chat_jid
		WHERE messages_fts MATCH ?
		ORDER BY fts.rank
		LIMIT ?
	`, query, limit)
	if err != nil {
		return nil, fmt.Errorf("search messages: %w", err)
	}
	defer rows.Close()

	results := make([]SearchResult, 0)
	for rows.Next() {
		var id, senderJID, senderName, body, chatJID, chatName string
		var fromMe, hasMedia int
		var ts int64
		var mediaType *string
		if err := rows.Scan(&id, &senderJID, &senderName, &fromMe, &body, &ts,
			&hasMedia, &mediaType, &chatJID, &chatName); err != nil {
			return nil, fmt.Errorf("scan search result: %w", err)
		}

		msg := Message{
			ID:        id,
			Body:      body,
			FromMe:    fromMe != 0,
			Timestamp: ts,
			From:      toAPIJIDString(senderJID),
			HasMedia:  hasMedia != 0,
			MediaType: mediaType,
		}
		if senderName != "" {
			sn := senderName
			msg.SenderName = &sn
		}

		results = append(results, SearchResult{
			Message:  msg,
			ChatName: chatName,
			ChatJID:  toAPIJIDString(chatJID),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate search results: %w", err)
	}
	return results, nil
}

