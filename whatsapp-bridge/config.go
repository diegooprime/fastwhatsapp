package main

import (
	"log"
	"os"
	"path/filepath"
)

// dataDir returns the directory for all persistent data (session DBs, API key).
// Uses DATA_DIR env var if set, otherwise falls back to ~/.whatsapp-raycast/.
func dataDir() string {
	if d := os.Getenv("DATA_DIR"); d != "" {
		return d
	}
	home, err := os.UserHomeDir()
	if err != nil {
		log.Fatalf("Cannot determine home directory: %v", err)
	}
	return filepath.Join(home, ".whatsapp-raycast")
}
