package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCommon"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

// Server holds the WhatsApp client and database store, providing HTTP handlers
// for every route the Raycast extension consumes.
type Server struct {
	wc    *WAClient
	store *AppStore
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON: %v", err)
	}
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func stripDataURL(s string) string {
	if idx := strings.Index(s, ";base64,"); idx != -1 {
		return s[idx+8:]
	}
	return s
}

// ---------------------------------------------------------------------------
// 1. GET /health
// ---------------------------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]interface{}{
		"ok":        true,
		"timestamp": time.Now().Unix(),
	})
}

// ---------------------------------------------------------------------------
// 2. GET /status
// ---------------------------------------------------------------------------

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.wc.GetStatus())
}

// ---------------------------------------------------------------------------
// 3. GET /qr
// ---------------------------------------------------------------------------

func (s *Server) handleQR(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.wc.GetQR())
}

// ---------------------------------------------------------------------------
// 4. GET /contacts
// ---------------------------------------------------------------------------

func (s *Server) handleContacts(w http.ResponseWriter, r *http.Request) {
	contacts, err := s.store.GetContacts()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("get contacts: %v", err))
		return
	}
	writeJSON(w, map[string]interface{}{"contacts": contacts})
}

// ---------------------------------------------------------------------------
// 5. GET /chats
// ---------------------------------------------------------------------------

func (s *Server) handleChats(w http.ResponseWriter, r *http.Request) {
	chats, err := s.store.GetChats()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("get chats: %v", err))
		return
	}
	writeJSON(w, map[string]interface{}{"chats": chats})
}

// ---------------------------------------------------------------------------
// 6. GET /chats/{chatId}/messages
// ---------------------------------------------------------------------------

func (s *Server) handleMessages(w http.ResponseWriter, r *http.Request) {
	chatID := r.PathValue("chatId")
	if chatID == "" {
		writeError(w, http.StatusBadRequest, "chatId is required")
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	var beforeTs int64
	if b := r.URL.Query().Get("before"); b != "" {
		if parsed, err := strconv.ParseInt(b, 10, 64); err == nil && parsed > 0 {
			beforeTs = parsed
		}
	}

	// Convert API JID to internal format for DB queries
	internalJID := toInternalJID(chatID)

	messages, err := s.store.GetMessages(internalJID, limit, beforeTs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("get messages: %v", err))
		return
	}

	resp := MessagesResponse{
		Messages:  messages,
		FromCache: true,
	}

	if len(messages) == 0 {
		empty := true
		resp.Empty = &empty
	}

	writeJSON(w, resp)
}

// ---------------------------------------------------------------------------
// 7. POST /mark-read/{chatId}
// ---------------------------------------------------------------------------

func (s *Server) handleMarkRead(w http.ResponseWriter, r *http.Request) {
	chatID := r.PathValue("chatId")
	if chatID == "" {
		writeError(w, http.StatusBadRequest, "chatId is required")
		return
	}

	internalJID := toInternalJID(chatID)

	// Mark read in our database
	if err := s.store.MarkRead(internalJID); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("mark read in db: %v", err))
		return
	}

	// Also mark read on WhatsApp
	latestID, err := s.store.GetLatestMessageID(internalJID)
	if err == nil && latestID != "" {
		parts := parseMessageIDParts(latestID)
		if parts != nil {
			chatJID := parseAPIJID(parts.chatJID)
			err := s.wc.client.MarkRead(
				context.Background(),
				[]types.MessageID{parts.messageID},
				time.Now(),
				chatJID,
				types.EmptyJID,
			)
			if err != nil {
				log.Printf("mark read on WhatsApp: %v", err)
			}
		}
	}

	writeJSON(w, map[string]bool{"success": true})
}

// ---------------------------------------------------------------------------
// 8. POST /send
// ---------------------------------------------------------------------------

func (s *Server) handleSend(w http.ResponseWriter, r *http.Request) {
	var req SendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if req.ChatID == "" || req.Message == "" {
		writeError(w, http.StatusBadRequest, "chatId and message are required")
		return
	}

	// TODO [HIGH][SECURITY]: Add rate limiting to prevent message spam and WhatsApp account bans.
	// Recommended: max 30 messages/minute across all chats, max 5 messages/minute per chat.

	const maxMessageLen = 65536 // 64KB - WhatsApp's practical limit
	if len(req.Message) > maxMessageLen {
		writeError(w, http.StatusBadRequest, "message too long (max 64KB)")
		return
	}

	chatJID := parseAPIJID(req.ChatID)

	var msg waE2E.Message
	if req.QuotedMessageID != nil && *req.QuotedMessageID != "" {
		// Reply to a specific message using ExtendedTextMessage
		parts := parseMessageIDParts(*req.QuotedMessageID)
		if parts == nil {
			writeError(w, http.StatusBadRequest, "invalid quotedMessageId format")
			return
		}
		participantJID := parts.chatJID
		msg.ExtendedTextMessage = &waE2E.ExtendedTextMessage{
			Text: proto.String(req.Message),
			ContextInfo: &waE2E.ContextInfo{
				StanzaID:    proto.String(parts.messageID),
				Participant: proto.String(participantJID),
			},
		}
	} else {
		msg.Conversation = proto.String(req.Message)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	resp, err := s.wc.client.SendMessage(ctx, chatJID, &msg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("send message: %v", err))
		return
	}

	formattedID := formatMessageID(true, toAPIJID(chatJID), resp.ID)
	writeJSON(w, map[string]interface{}{
		"success":   true,
		"messageId": formattedID,
	})
}

// ---------------------------------------------------------------------------
// 9. POST /send-image
// ---------------------------------------------------------------------------

func (s *Server) handleSendImage(w http.ResponseWriter, r *http.Request) {
	var req SendImageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if req.ChatID == "" || req.Base64 == "" {
		writeError(w, http.StatusBadRequest, "chatId and base64 are required")
		return
	}

	chatJID := parseAPIJID(req.ChatID)

	// Strip data URL prefix if present
	raw := stripDataURL(req.Base64)
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid base64: %v", err))
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Upload the image to WhatsApp servers
	uploaded, err := s.wc.client.Upload(ctx, data, whatsmeow.MediaImage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("upload image: %v", err))
		return
	}

	mimetype := http.DetectContentType(data)

	imgMsg := &waE2E.ImageMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(data))),
		Mimetype:      proto.String(mimetype),
	}
	if req.Caption != nil && *req.Caption != "" {
		imgMsg.Caption = proto.String(*req.Caption)
	}

	msg := &waE2E.Message{
		ImageMessage: imgMsg,
	}

	resp, err := s.wc.client.SendMessage(ctx, chatJID, msg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("send image: %v", err))
		return
	}

	formattedID := formatMessageID(true, toAPIJID(chatJID), resp.ID)
	writeJSON(w, map[string]interface{}{
		"success":   true,
		"messageId": formattedID,
	})
}

// ---------------------------------------------------------------------------
// 10. POST /react
// ---------------------------------------------------------------------------

func (s *Server) handleReact(w http.ResponseWriter, r *http.Request) {
	var req ReactRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if req.MessageID == "" || req.Emoji == "" {
		writeError(w, http.StatusBadRequest, "messageId and emoji are required")
		return
	}

	parts := parseMessageIDParts(req.MessageID)
	if parts == nil {
		writeError(w, http.StatusBadRequest, "invalid messageId format")
		return
	}

	chatJID := parseAPIJID(parts.chatJID)
	remoteJIDStr := chatJID.String()

	msg := &waE2E.Message{
		ReactionMessage: &waE2E.ReactionMessage{
			Key: &waCommon.MessageKey{
				RemoteJID: proto.String(remoteJIDStr),
				FromMe:    proto.Bool(parts.fromMe),
				ID:        proto.String(parts.messageID),
			},
			Text:              proto.String(req.Emoji),
			SenderTimestampMS: proto.Int64(time.Now().UnixMilli()),
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	_, err := s.wc.client.SendMessage(ctx, chatJID, msg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("send reaction: %v", err))
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}

// ---------------------------------------------------------------------------
// 11. POST /download-media
// ---------------------------------------------------------------------------

func (s *Server) handleDownloadMedia(w http.ResponseWriter, r *http.Request) {
	var req DownloadMediaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if req.MessageID == "" {
		writeError(w, http.StatusBadRequest, "messageId is required")
		return
	}

	rawProto, err := s.store.GetRawProto(req.MessageID)
	if err != nil {
		writeError(w, http.StatusNotFound, fmt.Sprintf("message not found: %v", err))
		return
	}
	if len(rawProto) == 0 {
		writeError(w, http.StatusNotFound, "no raw proto stored for this message")
		return
	}

	var msg waE2E.Message
	if err := proto.Unmarshal(rawProto, &msg); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("unmarshal proto: %v", err))
		return
	}

	data, err := s.wc.client.DownloadAny(context.Background(), &msg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("download media: %v", err))
		return
	}

	mimetype := detectMediaMimetype(&msg)

	writeJSON(w, map[string]string{
		"data":     base64.StdEncoding.EncodeToString(data),
		"mimetype": mimetype,
	})
}

// ---------------------------------------------------------------------------
// 12. POST /resolve-number
// ---------------------------------------------------------------------------

func (s *Server) handleResolveNumber(w http.ResponseWriter, r *http.Request) {
	var req ResolveNumberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if req.Number == "" {
		writeError(w, http.StatusBadRequest, "number is required")
		return
	}

	// Clean the number: strip +, spaces, dashes
	cleaned := strings.NewReplacer("+", "", " ", "", "-", "").Replace(req.Number)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	resp, err := s.wc.client.IsOnWhatsApp(ctx, []string{"+" + cleaned})
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("check number: %v", err))
		return
	}

	if len(resp) == 0 || !resp[0].IsIn {
		writeError(w, http.StatusNotFound, "number not on WhatsApp")
		return
	}

	apiJID := toAPIJID(resp[0].JID)
	writeJSON(w, map[string]string{"chatId": apiJID})
}

// ---------------------------------------------------------------------------
// 13. POST /sync-history
// ---------------------------------------------------------------------------

type SyncHistoryRequest struct {
	ChatID string `json:"chatId"`
	Count  int    `json:"count"`
}

func (s *Server) handleSyncHistory(w http.ResponseWriter, r *http.Request) {
	var req SyncHistoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if req.ChatID == "" {
		writeError(w, http.StatusBadRequest, "chatId is required")
		return
	}
	if req.Count <= 0 {
		req.Count = 50
	}

	internalJID := toInternalJID(req.ChatID)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := s.wc.RequestHistorySync(ctx, internalJID, req.Count); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("request history: %v", err))
		return
	}

	msgCount, _ := s.store.GetMessageCount(internalJID)
	writeJSON(w, map[string]interface{}{
		"success":      true,
		"chatId":       req.ChatID,
		"requested":    req.Count,
		"currentCount": msgCount,
		"note":         "Messages will arrive asynchronously via HistorySync events. Check back in a few seconds.",
	})
}

// ---------------------------------------------------------------------------
// 14. POST /sync-all
// ---------------------------------------------------------------------------

func (s *Server) handleSyncAll(w http.ResponseWriter, r *http.Request) {
	count := 50
	if c := r.URL.Query().Get("count"); c != "" {
		if parsed, err := strconv.Atoi(c); err == nil && parsed > 0 {
			count = parsed
		}
	}

	chatJIDs, err := s.store.GetAllChatJIDs()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("get chats: %v", err))
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	results := make([]map[string]interface{}, 0, len(chatJIDs))
	for _, jid := range chatJIDs {
		err := s.wc.RequestHistorySync(ctx, jid, count)
		status := "requested"
		errMsg := ""
		if err != nil {
			status = "error"
			errMsg = err.Error()
		}
		msgCount, _ := s.store.GetMessageCount(jid)
		result := map[string]interface{}{
			"chatId":       toAPIJIDString(jid),
			"status":       status,
			"currentCount": msgCount,
		}
		if errMsg != "" {
			result["error"] = errMsg
		}
		results = append(results, result)

		// Small delay between requests to avoid rate limiting
		time.Sleep(200 * time.Millisecond)
	}

	writeJSON(w, map[string]interface{}{
		"success":    true,
		"chatsCount": len(chatJIDs),
		"requested":  count,
		"results":    results,
	})
}

// ---------------------------------------------------------------------------
// 15. POST /deep-sync — aggressively pull ALL available history for every chat
// ---------------------------------------------------------------------------

func (s *Server) handleDeepSync(w http.ResponseWriter, r *http.Request) {
	deepSyncProgress.mu.Lock()
	running := deepSyncProgress.Running
	deepSyncProgress.mu.Unlock()

	if running {
		writeError(w, http.StatusConflict, "deep sync already in progress — GET /deep-sync for status")
		return
	}

	go s.wc.DeepSync()

	writeJSON(w, map[string]interface{}{
		"success": true,
		"message": "Deep sync started in background. GET /deep-sync to check progress.",
	})
}

// ---------------------------------------------------------------------------
// 16. GET /deep-sync — check progress of ongoing deep sync
// ---------------------------------------------------------------------------

func (s *Server) handleDeepSyncStatus(w http.ResponseWriter, r *http.Request) {
	deepSyncProgress.mu.Lock()
	defer deepSyncProgress.mu.Unlock()

	totalMsgs := 0
	if count, err := s.store.GetTotalMessageCount(); err == nil {
		totalMsgs = count
	}

	writeJSON(w, map[string]interface{}{
		"running":          deepSyncProgress.Running,
		"startedAt":        deepSyncProgress.StartedAt,
		"totalChats":       deepSyncProgress.TotalChats,
		"currentChat":      deepSyncProgress.CurrentChat,
		"chatIndex":        deepSyncProgress.ChatIndex,
		"completedChats":   len(deepSyncProgress.Results),
		"totalNewMessages": deepSyncProgress.TotalNew,
		"totalMessages":    totalMsgs,
		"results":          deepSyncProgress.Results,
	})
}

// ---------------------------------------------------------------------------
// 17. GET /ui — serve the explorer UI
// ---------------------------------------------------------------------------

var uiTmpl = template.Must(template.New("ui").Parse(uiHTML))

// TODO [HIGH][SECURITY]: The API key is embedded directly in the HTML response.
// Any browser extension or DevTools can read it. Consider using a session cookie
// or short-lived token instead of exposing the persistent API key in page source.
func (s *Server) handleUI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	uiTmpl.Execute(w, struct{ APIKey string }{APIKey: apiKey})
}

// ---------------------------------------------------------------------------
// 18. GET /search — full-text search across all messages
// ---------------------------------------------------------------------------

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		writeError(w, http.StatusBadRequest, "q parameter is required")
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	results, err := s.store.SearchMessages(query, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("search: %v", err))
		return
	}

	writeJSON(w, map[string]interface{}{
		"results": results,
		"count":   len(results),
	})
}

// ---------------------------------------------------------------------------
// 19. DELETE /chats/{chatId} — delete a chat and all its messages
// ---------------------------------------------------------------------------

func (s *Server) handleDeleteChat(w http.ResponseWriter, r *http.Request) {
	chatID := r.PathValue("chatId")
	if chatID == "" {
		writeError(w, http.StatusBadRequest, "chatId is required")
		return
	}

	internalJID := toInternalJID(chatID)
	if err := s.store.DeleteChat(internalJID); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("delete chat: %v", err))
		return
	}

	writeJSON(w, map[string]bool{"success": true})
}
