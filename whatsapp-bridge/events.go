package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waCommon "go.mau.fi/whatsmeow/proto/waCommon"
	waWeb "go.mau.fi/whatsmeow/proto/waWeb"
	"google.golang.org/protobuf/proto"
)

// handleEvent is the central event dispatcher registered with the whatsmeow client.
func (wc *WAClient) handleEvent(evt interface{}) {
	// Debug: log all event types to diagnose missing history sync
	switch evt.(type) {
	case *events.Connected, *events.Disconnected, *events.StreamReplaced,
		*events.HistorySync, *events.Message, *events.PushName, *events.Receipt,
		*events.OfflineSyncPreview, *events.OfflineSyncCompleted:
		// Known types — handled below
	default:
		log.Printf("EVENT: unhandled type %T", evt)
	}

	switch v := evt.(type) {
	case *events.Connected:
		wc.setStatus(StatusReady)
		log.Printf("WhatsApp connected and ready")
		// Log gap since last connection for diagnostics
		if gap, err := wc.store.GetOfflineGap(); err == nil && gap > 0 {
			log.Printf("Offline gap: %s (messages during this window may be missing)", gap)
		}
		wc.store.SetSyncState("last_connected_at", fmt.Sprintf("%d", time.Now().Unix()))
		// Mark as available so the phone responds to sync requests
		_ = wc.client.SendPresence(context.Background(), types.PresenceAvailable)
		// Reset all unread counts — history sync will set the correct ones
		if err := wc.store.ResetAllUnread(); err != nil {
			log.Printf("Error resetting unread counts: %v", err)
		}
		go wc.populateContacts()
		go wc.populateGroupNames()
		go wc.backfillGroupSenderNames()

	case *events.Disconnected:
		wc.setStatus(StatusDisconnected)
		wc.store.SetSyncState("last_disconnected_at", fmt.Sprintf("%d", time.Now().Unix()))
		log.Printf("WhatsApp disconnected, scheduling reconnect")
		go wc.reconnect()

	case *events.StreamReplaced:
		wc.setStatus(StatusDisconnected)
		log.Printf("WhatsApp stream replaced, scheduling reconnect")
		go wc.reconnect()

	case *events.HistorySync:
		wc.handleHistorySync(v)

	case *events.Message:
		wc.handleMessage(v)

	case *events.PushName:
		wc.handlePushName(v)

	case *events.Receipt:
		wc.handleReceipt(v)

	case *events.OfflineSyncPreview:
		log.Printf("Offline sync preview: total=%d messages=%d notifications=%d receipts=%d appdata=%d",
			v.Total, v.Messages, v.Notifications, v.Receipts, v.AppDataChanges)

	case *events.OfflineSyncCompleted:
		log.Printf("Offline sync completed, requesting recent messages for active chats")
		go wc.syncRecentChats()
	}
}

// handleHistorySync processes a history sync event, persisting conversations,
// messages, and contacts into the application store.
func (wc *WAClient) handleHistorySync(evt *events.HistorySync) {
	conversations := evt.Data.GetConversations()
	log.Printf("History sync: %d conversations", len(conversations))

	for _, conv := range conversations {
		chatJID := conv.GetID()
		chatName := conv.GetDisplayName()
		unread := conv.GetUnreadCount()
		isGroup := strings.HasSuffix(chatJID, "@g.us")

		var lastMsgBody *string
		var lastMsgTs *int64

		historyMessages := conv.GetMessages()
		for _, hsMsg := range historyMessages {
			webMsg := hsMsg.GetMessage()
			if webMsg == nil {
				continue
			}

			wc.processWebMessage(webMsg, chatJID, isGroup)

			// Track the latest message for the chat summary
			ts := int64(webMsg.GetMessageTimestamp())
			if lastMsgTs == nil || ts > *lastMsgTs {
				e2eMsg := webMsg.GetMessage()
				body := extractMessageBody(e2eMsg)
				if body != "" {
					lastMsgBody = &body
				}
				lastMsgTs = &ts
			}
		}

		if err := wc.store.UpsertChat(chatJID, chatName, isGroup, lastMsgBody, lastMsgTs); err != nil {
			log.Printf("Error upserting chat %s: %v", chatJID, err)
		}

		if err := wc.store.SetUnread(chatJID, int(unread)); err != nil {
			log.Printf("Error setting unread for %s: %v", chatJID, err)
		}

		// Upsert contact for non-group chats (always, even if name is empty)
		if !isGroup {
			number := extractNumber(chatJID)
			if err := wc.store.UpsertContact(chatJID, chatName, "", number, false); err != nil {
				log.Printf("Error upserting contact %s: %v", chatJID, err)
			}
		}
	}
}

// processWebMessage extracts data from a WebMessageInfo and persists it.
func (wc *WAClient) processWebMessage(webMsg *waWeb.WebMessageInfo, chatJID string, isGroup bool) {
	key := webMsg.GetKey()
	if key == nil {
		return
	}

	remoteJID := key.GetRemoteJID()
	fromMe := key.GetFromMe()
	rawMsgID := key.GetID()
	ts := int64(webMsg.GetMessageTimestamp())
	pushName := webMsg.GetPushName()
	e2eMsg := webMsg.GetMessage()

	body := extractMessageBody(e2eMsg)
	mediaType := getMediaType(e2eMsg)
	hasMedia := mediaType != nil

	var rawProto []byte
	if hasMedia && e2eMsg != nil {
		var err error
		rawProto, err = proto.Marshal(e2eMsg)
		if err != nil {
			log.Printf("Error marshalling proto for message %s: %v", rawMsgID, err)
			rawProto = nil
		}
	}

	// Determine sender JID
	senderJID := determineSenderJID(key, fromMe, wc.client.Store.ID, chatJID, isGroup)

	// Resolve sender name for group messages
	senderName := pushName
	if isGroup && !fromMe && senderJID != "" {
		senderParsed, _ := types.ParseJID(senderJID)
		resolved := wc.resolveSenderName(senderParsed, pushName, chatJID)
		if resolved != "" {
			senderName = resolved
		}
	}

	// Build the formatted message ID
	formattedID := formatMessageID(fromMe, toAPIJIDString(remoteJID), rawMsgID)

	if err := wc.store.UpsertMessage(
		formattedID,
		chatJID,
		senderJID,
		senderName,
		fromMe,
		body,
		ts,
		hasMedia,
		mediaType,
		rawProto,
	); err != nil {
		log.Printf("Error upserting message %s: %v", formattedID, err)
	}
}

// determineSenderJID resolves the sender JID from a message key.
// For group messages the participant field is used; for direct messages
// it is inferred from fromMe and the chat JID.
func determineSenderJID(key *waCommon.MessageKey, fromMe bool, ownID *types.JID, chatJID string, isGroup bool) string {
	if participant := key.GetParticipant(); participant != "" {
		return participant
	}

	if fromMe && ownID != nil {
		return ownID.String()
	}

	if !isGroup {
		return chatJID
	}

	return ""
}

// handleReceipt processes read receipts. When the user reads messages on
// another device (phone), WhatsApp sends a "read-self" receipt that we use
// to clear the unread count.
func (wc *WAClient) handleReceipt(evt *events.Receipt) {
	if evt.Type == events.ReceiptTypeReadSelf {
		chatJID := evt.Chat.String()
		if err := wc.store.MarkRead(chatJID); err != nil {
			log.Printf("Error marking read from receipt for %s: %v", chatJID, err)
		}
	}
}

// resolveSenderName attempts to find a better display name for a sender JID.
// It checks the whatsmeow contact store, app DB, and group participants.
func (wc *WAClient) resolveSenderName(senderJID types.JID, pushName string, chatJID ...string) string {
	// Try to get the contact name from whatsmeow's store
	contact, err := wc.client.Store.Contacts.GetContact(context.Background(), senderJID)
	if err == nil {
		if contact.FullName != "" {
			return contact.FullName
		}
		if contact.FirstName != "" {
			return contact.FirstName
		}
		if contact.BusinessName != "" {
			return contact.BusinessName
		}
		if contact.PushName != "" {
			return contact.PushName
		}
	}

	// Try our app DB contacts table as fallback
	name, err := wc.store.GetContactName(senderJID.String())
	if err == nil && name != "" {
		return name
	}

	// For LID JIDs in group chats, try to resolve via group participant info
	if senderJID.Server == "lid" && len(chatJID) > 0 && strings.HasSuffix(chatJID[0], "@g.us") {
		groupJID := parseAPIJID(toAPIJIDString(chatJID[0]))
		if info, err := wc.client.GetGroupInfo(context.Background(), groupJID); err == nil {
			for _, p := range info.Participants {
				if p.LID == senderJID || p.JID == senderJID {
					// Found the participant — look up their contact name
					pContact, err := wc.client.Store.Contacts.GetContact(context.Background(), p.JID)
					if err == nil && pContact.FullName != "" {
						return pContact.FullName
					}
					if err == nil && pContact.PushName != "" {
						return pContact.PushName
					}
					// Try app DB
					if n, err := wc.store.GetContactName(p.JID.String()); err == nil && n != "" {
						return n
					}
					// Fall back to phone number
					return p.JID.User
				}
			}
		}
	}

	// Fall back to push name
	return pushName
}

// handleMessage processes a real-time incoming or outgoing message.
func (wc *WAClient) handleMessage(evt *events.Message) {
	info := evt.Info
	chatJID := info.Chat.String()       // internal format for DB
	senderJID := info.Sender.String()   // internal format for DB
	fromMe := info.IsFromMe
	ts := info.Timestamp.Unix()
	rawMsgID := info.ID

	// Resolve sender name: contact name > push name > group participant
	senderName := wc.resolveSenderName(info.Sender, info.PushName, chatJID)

	e2eMsg := evt.Message
	body := extractMessageBody(e2eMsg)
	mediaType := getMediaType(e2eMsg)
	hasMedia := mediaType != nil

	var rawProto []byte
	if hasMedia && e2eMsg != nil {
		var err error
		rawProto, err = proto.Marshal(e2eMsg)
		if err != nil {
			log.Printf("Error marshalling proto for message %s: %v", rawMsgID, err)
			rawProto = nil
		}
	}

	formattedID := formatMessageID(fromMe, toAPIJIDString(chatJID), rawMsgID)

	if err := wc.store.UpsertMessage(
		formattedID,
		chatJID,
		senderJID,
		senderName,
		fromMe,
		body,
		ts,
		hasMedia,
		mediaType,
		rawProto,
	); err != nil {
		log.Printf("Error upserting message %s: %v", formattedID, err)
	}

	// Ensure the chat exists
	isGroup := strings.HasSuffix(chatJID, "@g.us")
	bodyPreview := truncate(body, 100)
	if err := wc.store.UpsertChat(chatJID, "", isGroup, &bodyPreview, &ts); err != nil {
		log.Printf("Error upserting chat %s: %v", chatJID, err)
	}

	// Update the chat last message
	if body != "" {
		if err := wc.store.UpdateChatLastMessage(chatJID, bodyPreview, ts); err != nil {
			log.Printf("Error updating chat last message %s: %v", chatJID, err)
		}
	}

	// Increment unread for incoming messages
	if !fromMe {
		if err := wc.store.IncrementUnread(chatJID); err != nil {
			log.Printf("Error incrementing unread for %s: %v", chatJID, err)
		}
	}

	log.Printf("Message %s in %s: %s", formattedID, chatJID, truncate(body, 50))
}

// handlePushName updates the push name for a contact.
func (wc *WAClient) handlePushName(evt *events.PushName) {
	jid := evt.JID.String() // internal format for DB consistency
	name := evt.NewPushName
	if name == "" {
		return
	}

	if err := wc.store.UpdatePushName(jid, name); err != nil {
		log.Printf("Error updating push name for %s: %v", jid, err)
	}
	log.Printf("Push name updated: %s -> %s", jid, name)
}

// populateContacts reads whatsmeow's internal contact store and upserts into our DB.
func (wc *WAClient) populateContacts() {
	contacts, err := wc.client.Store.Contacts.GetAllContacts(context.Background())
	if err != nil {
		log.Printf("Error getting contacts from store: %v", err)
		return
	}
	count := 0
	for jid, info := range contacts {
		if jid.Server != "s.whatsapp.net" {
			continue
		}
		name := info.FullName
		if name == "" {
			name = info.FirstName
		}
		if name == "" {
			name = info.BusinessName
		}
		pushName := info.PushName
		number := jid.User
		if err := wc.store.UpsertContact(jid.String(), name, pushName, number, false); err != nil {
			log.Printf("Error upserting contact %s: %v", jid, err)
		}
		count++
	}
	log.Printf("Populated %d contacts from whatsmeow store", count)
}

// populateGroupNames fetches group info for all group chats to get their real names.
func (wc *WAClient) populateGroupNames() {
	rows, err := wc.store.db.Query(`SELECT jid FROM chats WHERE is_group = 1 AND (name = '' OR name IS NULL)`)
	if err != nil {
		log.Printf("Error querying group chats: %v", err)
		return
	}
	defer rows.Close()

	var jids []string
	for rows.Next() {
		var jid string
		rows.Scan(&jid)
		jids = append(jids, jid)
	}

	count := 0
	for _, jidStr := range jids {
		jid := parseAPIJID(jidStr)
		info, err := wc.client.GetGroupInfo(context.Background(), jid)
		if err != nil {
			continue
		}
		if info.Name != "" {
			wc.store.db.Exec(`UPDATE chats SET name = ? WHERE jid = ?`, info.Name, jidStr)
			count++
		}
	}
	log.Printf("Populated %d group names", count)
}

// backfillGroupSenderNames resolves LID sender names in group messages.
// Runs once on connect to fix existing messages with empty sender names.
func (wc *WAClient) backfillGroupSenderNames() {
	// Find distinct LID senders with empty names in group chats
	rows, err := wc.store.db.Query(`
		SELECT DISTINCT m.sender_jid, m.chat_jid
		FROM messages m
		WHERE m.sender_jid LIKE '%@lid'
			AND (m.sender_name = '' OR m.sender_name IS NULL)
			AND m.chat_jid LIKE '%@g.us'
		LIMIT 100
	`)
	if err != nil {
		log.Printf("backfillGroupSenderNames: query error: %v", err)
		return
	}
	defer rows.Close()

	type lidChat struct{ lid, chat string }
	var pairs []lidChat
	for rows.Next() {
		var lid, chat string
		rows.Scan(&lid, &chat)
		pairs = append(pairs, lidChat{lid, chat})
	}

	if len(pairs) == 0 {
		return
	}

	// Cache group info to avoid redundant lookups
	groupCache := map[string]map[string]string{} // chatJID -> lidJID -> name
	updated := 0

	for _, p := range pairs {
		if _, ok := groupCache[p.chat]; !ok {
			groupJID := parseAPIJID(toAPIJIDString(p.chat))
			info, err := wc.client.GetGroupInfo(context.Background(), groupJID)
			if err != nil {
				groupCache[p.chat] = map[string]string{}
				continue
			}
			m := map[string]string{}
			for _, participant := range info.Participants {
				lidStr := participant.LID.String()
				// Try to resolve name
				name := ""
				if c, err := wc.client.Store.Contacts.GetContact(context.Background(), participant.JID); err == nil {
					if c.FullName != "" {
						name = c.FullName
					} else if c.PushName != "" {
						name = c.PushName
					}
				}
				if name == "" {
					if n, err := wc.store.GetContactName(participant.JID.String()); err == nil && n != "" {
						name = n
					}
				}
				if name == "" {
					name = participant.JID.User // phone number as last resort
				}
				m[lidStr] = name
			}
			groupCache[p.chat] = m
		}

		if name, ok := groupCache[p.chat][p.lid]; ok && name != "" {
			wc.store.db.Exec(`UPDATE messages SET sender_name = ? WHERE sender_jid = ? AND chat_jid = ? AND (sender_name = '' OR sender_name IS NULL)`,
				name, p.lid, p.chat)
			updated++
		}
	}
	if updated > 0 {
		log.Printf("Backfilled %d group sender names from %d groups", updated, len(groupCache))
	}
}

// syncRecentChats requests recent messages for the top chats on connect.
// This backfills messages that were missed while the bridge was offline.
func (wc *WAClient) syncRecentChats() {
	// Wait a moment for the connection to stabilize
	time.Sleep(2 * time.Second)

	chats, err := wc.store.GetChats()
	if err != nil {
		log.Printf("syncRecentChats: error getting chats: %v", err)
		return
	}

	// Sync the 5 most recent chats (already sorted by last_msg_ts desc).
	// On-demand sync is best-effort — phone often ignores requests (whatsmeow #654).
	limit := 5
	if len(chats) < limit {
		limit = len(chats)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	synced := 0
	for i := 0; i < limit; i++ {
		internalJID := toInternalJID(chats[i].ID)
		if err := wc.RequestRecentMessages(ctx, internalJID, 50); err != nil {
			log.Printf("syncRecentChats: error requesting %s: %v", chats[i].ID, err)
			continue
		}
		synced++
		// Small delay between requests to avoid rate limiting
		time.Sleep(200 * time.Millisecond)
	}
	log.Printf("syncRecentChats: requested recent messages for %d chats", synced)
}

// truncate returns at most the first n characters of a string.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
