package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/skip2/go-qrcode"
	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// WAClient manages the whatsmeow client lifecycle including connection,
// QR code authentication, and reconnection.
type WAClient struct {
	client       *whatsmeow.Client
	status       ConnectionStatus
	qrCode       *string
	mu           sync.RWMutex
	store        *AppStore
	handlerOnce  sync.Once
	reconnecting sync.Mutex // prevents concurrent reconnect goroutines
}

// NewWAClient initialises a WAClient backed by a SQLite session store at
// ~/.whatsapp-raycast/whatsmeow.db and the provided application data store.
func NewWAClient(appStore *AppStore) (*WAClient, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("get home dir: %w", err)
	}

	dir := filepath.Join(home, ".whatsapp-raycast")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	dbPath := filepath.Join(dir, "whatsmeow.db")
	container, err := sqlstore.New(
		context.Background(),
		"sqlite3",
		"file:"+dbPath+"?_foreign_keys=on&_busy_timeout=5000",
		waLog.Noop,
	)
	if err != nil {
		return nil, fmt.Errorf("open session store: %w", err)
	}

	device, err := container.GetFirstDevice(context.Background())
	if err != nil {
		return nil, fmt.Errorf("get first device: %w", err)
	}

	client := whatsmeow.NewClient(device, waLog.Stdout("WA", "INFO", true))

	return &WAClient{
		client: client,
		status: StatusDisconnected,
		store:  appStore,
	}, nil
}

// Connect starts the WhatsApp connection. If the device is not yet paired it
// presents a QR code flow; otherwise it reconnects using the stored session.
func (wc *WAClient) Connect() error {
	// Only register event handler once (Connect is also called on reconnect)
	wc.handlerOnce.Do(func() {
		wc.client.AddEventHandler(wc.handleEvent)
	})

	if wc.client.Store.ID == nil {
		// First-time pairing: QR code flow
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		qrChan, _ := wc.client.GetQRChannel(ctx)

		if err := wc.client.Connect(); err != nil {
			cancel()
			return fmt.Errorf("connect (QR flow): %w", err)
		}

		go func() {
			defer cancel()
			for evt := range qrChan {
				switch evt.Event {
				case "code":
					code := evt.Code
					wc.mu.Lock()
					wc.qrCode = &code
					wc.status = StatusQR
					wc.mu.Unlock()
					log.Printf("QR code received, scan to authenticate")

				case "success":
					wc.mu.Lock()
					wc.qrCode = nil
					wc.status = StatusAuthenticated
					wc.mu.Unlock()
					log.Printf("QR authentication successful")

				case "timeout":
					log.Printf("QR code timed out, attempting reconnect")
					wc.mu.Lock()
					wc.qrCode = nil
					wc.mu.Unlock()
					wc.reconnect()
					return
				}
			}
		}()

		return nil
	}

	// Already paired: reconnect with stored session
	wc.setStatus(StatusConnecting)
	if err := wc.client.Connect(); err != nil {
		return fmt.Errorf("connect (existing session): %w", err)
	}
	return nil
}

// Disconnect cleanly shuts down the WhatsApp client.
func (wc *WAClient) Disconnect() {
	wc.client.Disconnect()
	wc.setStatus(StatusDisconnected)
}

// GetStatus returns the current connection status including offline gap info.
func (wc *WAClient) GetStatus() StatusResponse {
	wc.mu.RLock()
	defer wc.mu.RUnlock()
	resp := StatusResponse{
		Status: wc.status,
		Ready:  wc.status == StatusReady,
	}
	if ts, err := wc.store.GetSyncState("last_connected_at"); err == nil {
		var v int64
		if _, err := fmt.Sscanf(ts, "%d", &v); err == nil {
			resp.LastConnectedAt = &v
		}
	}
	if ts, err := wc.store.GetSyncState("last_disconnected_at"); err == nil {
		var v int64
		if _, err := fmt.Sscanf(ts, "%d", &v); err == nil {
			resp.LastDisconnectedAt = &v
		}
	}
	if resp.LastDisconnectedAt != nil && resp.LastConnectedAt != nil && *resp.LastConnectedAt > *resp.LastDisconnectedAt {
		gap := *resp.LastConnectedAt - *resp.LastDisconnectedAt
		resp.OfflineGapSecs = &gap
	}
	return resp
}

// GetQR returns a QR response. When a QR code is available the response
// contains a data-URL PNG image; otherwise a human-readable status message.
func (wc *WAClient) GetQR() QRResponse {
	wc.mu.RLock()
	defer wc.mu.RUnlock()

	if wc.qrCode != nil {
		png, err := generateQRPNG(*wc.qrCode)
		if err != nil {
			msg := fmt.Sprintf("Error generating QR: %v", err)
			return QRResponse{Message: &msg}
		}
		dataURL := "data:image/png;base64," + png
		return QRResponse{QR: &dataURL}
	}

	var msg string
	switch wc.status {
	case StatusReady:
		msg = "Already connected"
	case StatusConnecting:
		msg = "Connecting..."
	case StatusAuthenticated:
		msg = "Authenticated, waiting for ready state"
	default:
		msg = "No QR code available (status: " + string(wc.status) + ")"
	}
	return QRResponse{Message: &msg}
}

// setStatus safely updates the connection status.
func (wc *WAClient) setStatus(s ConnectionStatus) {
	wc.mu.Lock()
	defer wc.mu.Unlock()
	wc.status = s
}

// reconnect performs a single disconnect-sleep-connect cycle.
// The mutex prevents concurrent reconnects (e.g. StreamReplaced → Disconnect → Disconnected).
func (wc *WAClient) reconnect() {
	if !wc.reconnecting.TryLock() {
		log.Printf("Reconnect already in progress, skipping")
		return
	}
	defer wc.reconnecting.Unlock()

	wc.client.Disconnect()
	wc.setStatus(StatusDisconnected)
	log.Printf("Reconnecting in 5 seconds...")
	time.Sleep(5 * time.Second)
	if err := wc.Connect(); err != nil {
		log.Printf("Reconnect failed: %v", err)
	}
}

// RequestHistorySync sends an on-demand history sync request to the primary device.
// It asks for `count` messages before the given anchor point. If the chat has no
// messages yet, a dummy anchor at the current time is used.
func (wc *WAClient) RequestHistorySync(ctx context.Context, chatJID string, count int) error {
	oldest, err := wc.store.GetOldestMessage(chatJID)
	if err != nil {
		// No messages — fabricate an anchor at current time
		msgInfo := &types.MessageInfo{
			MessageSource: types.MessageSource{
				Chat:     parseAPIJID(toAPIJIDString(chatJID)),
				IsFromMe: true,
			},
			ID:        "FFFFFFFFFFFFFFFFFFFFFFFF",
			Timestamp: time.Now(),
		}
		req := wc.client.BuildHistorySyncRequest(msgInfo, count)
		_, err := wc.client.SendPeerMessage(ctx, req)
		if err != nil {
			return fmt.Errorf("send history sync request (no anchor): %w", err)
		}
		log.Printf("Requested %d messages for %s (no existing messages, using now as anchor)", count, chatJID)
		return nil
	}

	// Use the oldest existing message as anchor to request older messages
	chatJIDParsed := parseAPIJID(toAPIJIDString(oldest.ChatJID))
	msgInfo := &types.MessageInfo{
		MessageSource: types.MessageSource{
			Chat:     chatJIDParsed,
			IsFromMe: oldest.FromMe,
		},
		ID:        oldest.RawMsgID,
		Timestamp: time.Unix(oldest.Ts, 0),
	}
	req := wc.client.BuildHistorySyncRequest(msgInfo, count)
	_, err = wc.client.SendPeerMessage(ctx, req)
	if err != nil {
		return fmt.Errorf("send history sync request: %w", err)
	}
	log.Printf("Requested %d messages before oldest in %s (anchor: %s at %d)", count, chatJID, oldest.RawMsgID, oldest.Ts)
	return nil
}

// RequestRecentMessages requests the most recent messages for a chat by
// anchoring at the current time. Unlike RequestHistorySync which pages
// backwards from the oldest message, this always fetches the latest messages.
func (wc *WAClient) RequestRecentMessages(ctx context.Context, chatJID string, count int) error {
	msgInfo := &types.MessageInfo{
		MessageSource: types.MessageSource{
			Chat:     parseAPIJID(toAPIJIDString(chatJID)),
			IsFromMe: true,
		},
		ID:        "FFFFFFFFFFFFFFFFFFFFFFFF",
		Timestamp: time.Now(),
	}
	req := wc.client.BuildHistorySyncRequest(msgInfo, count)
	_, err := wc.client.SendPeerMessage(ctx, req)
	if err != nil {
		return fmt.Errorf("request recent messages: %w", err)
	}
	log.Printf("Requested %d recent messages for %s (now anchor)", count, chatJID)
	return nil
}

// DeepSyncProgress tracks the progress of a deep sync operation.
type DeepSyncProgress struct {
	mu          sync.Mutex
	Running     bool                `json:"running"`
	StartedAt   time.Time           `json:"startedAt"`
	TotalChats  int                 `json:"totalChats"`
	CurrentChat string              `json:"currentChat"`
	ChatIndex   int                 `json:"chatIndex"`
	Results     []DeepSyncChatResult `json:"results"`
	TotalNew    int                 `json:"totalNewMessages"`
}

type DeepSyncChatResult struct {
	ChatJID  string `json:"chatId"`
	Before   int    `json:"messagesBefore"`
	After    int    `json:"messagesAfter"`
	New      int    `json:"newMessages"`
	Rounds   int    `json:"rounds"`
	Status   string `json:"status"`
}

var deepSyncProgress = &DeepSyncProgress{}

// DeepSync aggressively pulls all available history for every chat.
// It loops each chat, requesting 50 messages at a time, until the count
// stops growing (2 consecutive rounds with no change).
func (wc *WAClient) DeepSync() {
	deepSyncProgress.mu.Lock()
	if deepSyncProgress.Running {
		deepSyncProgress.mu.Unlock()
		return
	}
	deepSyncProgress.Running = true
	deepSyncProgress.StartedAt = time.Now()
	deepSyncProgress.Results = nil
	deepSyncProgress.TotalNew = 0
	deepSyncProgress.mu.Unlock()

	defer func() {
		deepSyncProgress.mu.Lock()
		deepSyncProgress.Running = false
		deepSyncProgress.CurrentChat = ""
		deepSyncProgress.mu.Unlock()
		log.Printf("Deep sync complete: %d new messages total", deepSyncProgress.TotalNew)
	}()

	chatJIDs, err := wc.store.GetAllChatJIDs()
	if err != nil {
		log.Printf("Deep sync: failed to get chat JIDs: %v", err)
		return
	}

	deepSyncProgress.mu.Lock()
	deepSyncProgress.TotalChats = len(chatJIDs)
	deepSyncProgress.mu.Unlock()

	for i, jid := range chatJIDs {
		deepSyncProgress.mu.Lock()
		deepSyncProgress.CurrentChat = toAPIJIDString(jid)
		deepSyncProgress.ChatIndex = i + 1
		deepSyncProgress.mu.Unlock()

		beforeCount, _ := wc.store.GetMessageCount(jid)
		staleRounds := 0
		rounds := 0
		lastCount := beforeCount

		// Reduced from 30 to 5 — phone often ignores on-demand sync requests (whatsmeow #654).
		// Exit after 1 stale round (was 2) since no response likely means phone won't respond.
		for staleRounds < 1 && rounds < 5 {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			err := wc.RequestHistorySync(ctx, jid, 50)
			cancel()
			if err != nil {
				log.Printf("Deep sync: error requesting %s round %d: %v", jid, rounds+1, err)
				break
			}
			rounds++

			// Wait for messages to arrive
			time.Sleep(10 * time.Second)

			currentCount, _ := wc.store.GetMessageCount(jid)
			if currentCount == lastCount {
				staleRounds++
			} else {
				staleRounds = 0
			}
			lastCount = currentCount
			log.Printf("Deep sync: %s round %d — %d messages (was %d)", jid, rounds, currentCount, beforeCount)
		}

		afterCount, _ := wc.store.GetMessageCount(jid)
		newMsgs := afterCount - beforeCount
		status := "complete"
		if rounds >= 30 {
			status = "max_rounds"
		}

		result := DeepSyncChatResult{
			ChatJID: toAPIJIDString(jid),
			Before:  beforeCount,
			After:   afterCount,
			New:     newMsgs,
			Rounds:  rounds,
			Status:  status,
		}

		deepSyncProgress.mu.Lock()
		deepSyncProgress.Results = append(deepSyncProgress.Results, result)
		deepSyncProgress.TotalNew += newMsgs
		deepSyncProgress.mu.Unlock()
	}
}

// generateQRPNG encodes a QR code string into a base64-encoded 256x256 PNG.
func generateQRPNG(code string) (string, error) {
	png, err := qrcode.Encode(code, qrcode.Medium, 256)
	if err != nil {
		return "", fmt.Errorf("encode QR: %w", err)
	}
	return base64.StdEncoding.EncodeToString(png), nil
}
