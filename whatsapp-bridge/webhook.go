package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// webhookPayload is the JSON body sent to the configured WEBHOOK_URL.
type webhookPayload struct {
	ChatID     string `json:"chatId"`
	SenderName string `json:"senderName"`
	Message    string `json:"message"`
	Timestamp  int64  `json:"timestamp"`
}

// forwardToWebhook sends an incoming message to the configured WEBHOOK_URL.
// If WEBHOOK_URL is not set, this is a no-op.
// Only non-group, non-fromMe messages with a non-empty body are forwarded.
func forwardToWebhook(chatJID, senderName, body string, ts int64) {
	url := os.Getenv("WEBHOOK_URL")
	if url == "" {
		return
	}

	// Skip group messages
	if strings.HasSuffix(chatJID, "@g.us") {
		return
	}

	payload := webhookPayload{
		ChatID:     chatJID,
		SenderName: senderName,
		Message:    body,
		Timestamp:  ts,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("webhook: marshal error: %v", err)
		return
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(data))
	if err != nil {
		log.Printf("webhook: request error: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if secret := os.Getenv("WEBHOOK_SECRET"); secret != "" {
		req.Header.Set("x-webhook-secret", secret)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("webhook: POST error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		log.Printf("webhook: forwarded message from %s (status %d)", senderName, resp.StatusCode)
	} else {
		log.Printf("webhook: non-OK response %d for message from %s", resp.StatusCode, senderName)
	}
}
