package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

var apiKey string

func loadOrCreateAPIKey() error {
	keyPath := filepath.Join(dataDir(), "api-key")

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

	if err := os.MkdirAll(filepath.Dir(keyPath), 0700); err != nil {
		return fmt.Errorf("create API key dir: %w", err)
	}
	if err := os.WriteFile(keyPath, []byte(apiKey), 0600); err != nil {
		return fmt.Errorf("write API key: %w", err)
	}

	fmt.Printf("Generated new API key — saved to %s\n", keyPath)
	return nil
}

func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}

		// Accept API key from header or query param (for /ui browser access)
		key := r.Header.Get("X-API-Key")
		if key == "" {
			key = r.URL.Query().Get("key")
		}
		if key == "" || subtle.ConstantTimeCompare([]byte(key), []byte(apiKey)) != 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"Unauthorized: Invalid or missing API key"}`))
			return
		}

		next.ServeHTTP(w, r)
	})
}
