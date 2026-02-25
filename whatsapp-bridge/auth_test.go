package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthMiddleware_HealthBypass(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	handler := authMiddleware(inner)

	// /health should bypass auth
	req := httptest.NewRequest("GET", "/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("GET /health without API key: status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestAuthMiddleware_UIBypass(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := authMiddleware(inner)

	req := httptest.NewRequest("GET", "/ui", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("GET /ui without API key: status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestAuthMiddleware_MissingKey(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called when API key is missing")
	})

	// Set a known API key for testing
	oldKey := apiKey
	apiKey = "test-secret-key-123"
	defer func() { apiKey = oldKey }()

	handler := authMiddleware(inner)

	req := httptest.NewRequest("GET", "/chats", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("GET /chats without API key: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestAuthMiddleware_WrongKey(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called with wrong API key")
	})

	oldKey := apiKey
	apiKey = "correct-key"
	defer func() { apiKey = oldKey }()

	handler := authMiddleware(inner)

	req := httptest.NewRequest("GET", "/chats", nil)
	req.Header.Set("X-API-Key", "wrong-key")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("GET /chats with wrong key: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestAuthMiddleware_CorrectKey(t *testing.T) {
	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	oldKey := apiKey
	apiKey = "correct-key"
	defer func() { apiKey = oldKey }()

	handler := authMiddleware(inner)

	req := httptest.NewRequest("GET", "/chats", nil)
	req.Header.Set("X-API-Key", "correct-key")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("GET /chats with correct key: status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !called {
		t.Error("inner handler was not called with correct API key")
	}
}
