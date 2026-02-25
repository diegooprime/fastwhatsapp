package main

import (
	"testing"
)

func TestStripDataURL(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "with data URL prefix",
			input: "data:image/png;base64,iVBORw0KGgoAAAA",
			want:  "iVBORw0KGgoAAAA",
		},
		{
			name:  "without prefix",
			input: "iVBORw0KGgoAAAA",
			want:  "iVBORw0KGgoAAAA",
		},
		{
			name:  "jpeg data URL",
			input: "data:image/jpeg;base64,/9j/4AAQ",
			want:  "/9j/4AAQ",
		},
		{
			name:  "empty string",
			input: "",
			want:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := stripDataURL(tt.input)
			if got != tt.want {
				t.Errorf("stripDataURL(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestBoolToInt(t *testing.T) {
	if boolToInt(true) != 1 {
		t.Error("boolToInt(true) != 1")
	}
	if boolToInt(false) != 0 {
		t.Error("boolToInt(false) != 0")
	}
}

func TestTruncate(t *testing.T) {
	tests := []struct {
		input string
		n     int
		want  string
	}{
		{"hello", 10, "hello"},
		{"hello world", 5, "hello..."},
		{"", 5, ""},
		{"abc", 3, "abc"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := truncate(tt.input, tt.n)
			if got != tt.want {
				t.Errorf("truncate(%q, %d) = %q, want %q", tt.input, tt.n, got, tt.want)
			}
		})
	}
}
