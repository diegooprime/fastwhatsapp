package main

// Response types — must match raycast-whatsapp/src/api.ts exactly

type Contact struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Number  string `json:"number"`
	IsGroup bool   `json:"isGroup"`
}

type Message struct {
	ID         string  `json:"id"`
	Body       string  `json:"body"`
	FromMe     bool    `json:"fromMe"`
	Timestamp  int64   `json:"timestamp"`
	From       string  `json:"from"`
	SenderName *string `json:"senderName,omitempty"`
	HasMedia   bool    `json:"hasMedia"`
	MediaType  *string `json:"mediaType,omitempty"`
}

type MessagesResponse struct {
	Messages  []Message `json:"messages"`
	FromCache bool      `json:"fromCache"`
	Empty     *bool     `json:"empty,omitempty"`
}

type Chat struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	UnreadCount          int    `json:"unreadCount"`
	LastMessage          *string `json:"lastMessage,omitempty"`
	LastMessageTimestamp  *int64  `json:"lastMessageTimestamp,omitempty"`
	IsGroup              bool   `json:"isGroup"`
	MessageCount         int    `json:"messageCount"`
}

type ConnectionStatus string

const (
	StatusDisconnected  ConnectionStatus = "disconnected"
	StatusConnecting    ConnectionStatus = "connecting"
	StatusQR            ConnectionStatus = "qr"
	StatusAuthenticated ConnectionStatus = "authenticated"
	StatusReady         ConnectionStatus = "ready"
)

type StatusResponse struct {
	Status ConnectionStatus `json:"status"`
	Ready  bool             `json:"ready"`
}

type QRResponse struct {
	QR      *string `json:"qr"`
	Message *string `json:"message,omitempty"`
}

// Request bodies

type SendRequest struct {
	ChatID          string  `json:"chatId"`
	Message         string  `json:"message"`
	QuotedMessageID *string `json:"quotedMessageId,omitempty"`
}

type SendImageRequest struct {
	ChatID  string  `json:"chatId"`
	Base64  string  `json:"base64"`
	Caption *string `json:"caption,omitempty"`
}

type ReactRequest struct {
	MessageID string `json:"messageId"`
	Emoji     string `json:"emoji"`
}

type DownloadMediaRequest struct {
	MessageID string `json:"messageId"`
}

type ResolveNumberRequest struct {
	Number string `json:"number"`
}

// Search types

type SearchResult struct {
	Message
	ChatName string `json:"chatName"`
	ChatJID  string `json:"chatJid"`
}

// Internal types

type msgIDParts struct {
	fromMe    bool
	chatJID   string
	messageID string
}
