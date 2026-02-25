package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

var apiKey string

func loadOrCreateAPIKey() error {
	home, _ := os.UserHomeDir()
	keyPath := filepath.Join(home, ".whatsapp-raycast", "api-key")

	data, err := os.ReadFile(keyPath)
	if err == nil {
		apiKey = strings.TrimSpace(string(data))
		if apiKey != "" {
			return nil
		}
	}

	// Generate new key
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Errorf("generate API key: %w", err)
	}
	apiKey = hex.EncodeToString(bytes)

	os.MkdirAll(filepath.Dir(keyPath), 0700)
	if err := os.WriteFile(keyPath, []byte(apiKey), 0600); err != nil {
		return fmt.Errorf("write API key: %w", err)
	}

	fmt.Printf("Generated new API key: %s\n", apiKey)
	return nil
}

func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// TODO [HIGH][SECURITY]: /ui bypasses auth and exposes a full chat explorer.
		// Any local process can access it without an API key. Consider requiring
		// auth for /ui and passing the key via a query param or session cookie.
		if r.URL.Path == "/health" || r.URL.Path == "/ui" {
			next.ServeHTTP(w, r)
			return
		}

		key := r.Header.Get("X-API-Key")
		if key == "" || key != apiKey {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"Unauthorized: Invalid or missing API key"}`))
			return
		}

		next.ServeHTTP(w, r)
	})
}
