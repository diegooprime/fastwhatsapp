package main

import (
	"context"
	"log"
	"strings"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waCommon "go.mau.fi/whatsmeow/proto/waCommon"
	waWeb "go.mau.fi/whatsmeow/proto/waWeb"
	"google.golang.org/protobuf/proto"
)

// handleEvent is the central event dispatcher registered with the whatsmeow client.
func (wc *WAClient) handleEvent(evt interface{}) {
	switch v := evt.(type) {
	case *events.Connected:
		wc.setStatus(StatusReady)
		log.Printf("WhatsApp connected and ready")
		go wc.populateContacts()
		go wc.populateGroupNames()

	case *events.Disconnected:
		wc.setStatus(StatusDisconnected)
		log.Printf("WhatsApp disconnected, scheduling reconnect")
		go wc.reconnect()

	case *events.HistorySync:
		wc.handleHistorySync(v)

	case *events.Message:
		wc.handleMessage(v)

	case *events.PushName:
		wc.handlePushName(v)
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

		if unread > 0 {
			if err := wc.store.SetUnread(chatJID, int(unread)); err != nil {
				log.Printf("Error setting unread for %s: %v", chatJID, err)
			}
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

	// Build the formatted message ID
	formattedID := formatMessageID(fromMe, toAPIJIDString(remoteJID), rawMsgID)

	if err := wc.store.UpsertMessage(
		formattedID,
		chatJID,
		senderJID,
		pushName,
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

// handleMessage processes a real-time incoming or outgoing message.
func (wc *WAClient) handleMessage(evt *events.Message) {
	info := evt.Info
	chatJID := info.Chat.String()       // internal format for DB
	senderJID := info.Sender.String()   // internal format for DB
	fromMe := info.IsFromMe
	ts := info.Timestamp.Unix()
	rawMsgID := info.ID
	pushName := info.PushName

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
		pushName,
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

// truncate returns at most the first n characters of a string.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
