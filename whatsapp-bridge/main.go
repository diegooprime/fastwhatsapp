package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	// 1. Load or create API key for authentication
	if err := loadOrCreateAPIKey(); err != nil {
		log.Fatalf("Failed to load API key: %v", err)
	}
	log.Printf("API key loaded (%d chars)", len(apiKey))

	// 2. Initialize the SQLite data store
	appStore, err := NewAppStore()
	if err != nil {
		log.Fatalf("Failed to init store: %v", err)
	}
	defer appStore.Close()
	log.Println("Database initialized")

	// 3. Initialize the WhatsApp client
	wc, err := NewWAClient(appStore)
	if err != nil {
		log.Fatalf("Failed to init WhatsApp client: %v", err)
	}

	// 4. Connect to WhatsApp
	if err := wc.Connect(); err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	log.Println("WhatsApp client connected")

	// 5. Set up HTTP routes (Go 1.22+ method+pattern routing)
	srv := &Server{wc: wc, store: appStore}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", srv.handleHealth)
	mux.HandleFunc("GET /status", srv.handleStatus)
	mux.HandleFunc("GET /qr", srv.handleQR)
	mux.HandleFunc("GET /contacts", srv.handleContacts)
	mux.HandleFunc("GET /chats", srv.handleChats)
	mux.HandleFunc("GET /chats/{chatId}/messages", srv.handleMessages)
	mux.HandleFunc("POST /mark-read/{chatId}", srv.handleMarkRead)
	mux.HandleFunc("POST /send", srv.handleSend)
	mux.HandleFunc("POST /send-image", srv.handleSendImage)
	mux.HandleFunc("POST /react", srv.handleReact)
	mux.HandleFunc("POST /download-media", srv.handleDownloadMedia)
	mux.HandleFunc("POST /resolve-number", srv.handleResolveNumber)
	mux.HandleFunc("POST /sync-history", srv.handleSyncHistory)
	mux.HandleFunc("POST /sync-all", srv.handleSyncAll)
	mux.HandleFunc("POST /deep-sync", srv.handleDeepSync)
	mux.HandleFunc("GET /deep-sync", srv.handleDeepSyncStatus)
	mux.HandleFunc("GET /search", srv.handleSearch)
	mux.HandleFunc("GET /ui", srv.handleUI)
	mux.HandleFunc("DELETE /chats/{chatId}", srv.handleDeleteChat)

	// 6. Wrap with auth middleware
	handler := authMiddleware(mux)

	// 7. Configure and start HTTP server
	httpServer := &http.Server{
		Addr:           "127.0.0.1:3847",
		Handler:        handler,
		ReadTimeout:    30 * time.Second,
		WriteTimeout:   60 * time.Second,
		MaxHeaderBytes: 1 << 20, // 1 MB
	}

	// Start server in a goroutine
	go func() {
		log.Printf("HTTP server listening on %s", httpServer.Addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// 8. Graceful shutdown on SIGINT/SIGTERM
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Printf("Received signal %v, shutting down...", sig)

	// Disconnect WhatsApp client
	wc.Disconnect()
	log.Println("WhatsApp client disconnected")

	// Shutdown HTTP server with 5-second timeout
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}

	log.Println("Shutdown complete")
}
