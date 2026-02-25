package main

import (
	"testing"

	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func TestGetMediaType(t *testing.T) {
	tests := []struct {
		name string
		msg  *waE2E.Message
		want *string
	}{
		{"nil message", nil, nil},
		{"empty message", &waE2E.Message{}, nil},
		{"image message", &waE2E.Message{ImageMessage: &waE2E.ImageMessage{}}, strPtr("image")},
		{"video message", &waE2E.Message{VideoMessage: &waE2E.VideoMessage{}}, strPtr("video")},
		{"audio message", &waE2E.Message{AudioMessage: &waE2E.AudioMessage{}}, strPtr("audio")},
		{"sticker message", &waE2E.Message{StickerMessage: &waE2E.StickerMessage{}}, strPtr("sticker")},
		{"document message", &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{}}, strPtr("document")},
		{"text only", &waE2E.Message{Conversation: proto.String("hello")}, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := getMediaType(tt.msg)
			if tt.want == nil {
				if got != nil {
					t.Errorf("getMediaType() = %q, want nil", *got)
				}
				return
			}
			if got == nil {
				t.Fatalf("getMediaType() = nil, want %q", *tt.want)
			}
			if *got != *tt.want {
				t.Errorf("getMediaType() = %q, want %q", *got, *tt.want)
			}
		})
	}
}

func TestHasMediaContent(t *testing.T) {
	if hasMediaContent(nil) {
		t.Error("hasMediaContent(nil) = true, want false")
	}
	if hasMediaContent(&waE2E.Message{}) {
		t.Error("hasMediaContent(empty) = true, want false")
	}
	if !hasMediaContent(&waE2E.Message{ImageMessage: &waE2E.ImageMessage{}}) {
		t.Error("hasMediaContent(image) = false, want true")
	}
}

func TestExtractMessageBody(t *testing.T) {
	tests := []struct {
		name string
		msg  *waE2E.Message
		want string
	}{
		{"nil message", nil, ""},
		{"empty message", &waE2E.Message{}, ""},
		{"conversation", &waE2E.Message{Conversation: proto.String("hello world")}, "hello world"},
		{"extended text", &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String("extended")}}, "extended"},
		{"image caption", &waE2E.Message{ImageMessage: &waE2E.ImageMessage{Caption: proto.String("nice pic")}}, "nice pic"},
		{"video caption", &waE2E.Message{VideoMessage: &waE2E.VideoMessage{Caption: proto.String("cool vid")}}, "cool vid"},
		{"document caption", &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{Caption: proto.String("my doc")}}, "my doc"},
		{"image no caption", &waE2E.Message{ImageMessage: &waE2E.ImageMessage{}}, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractMessageBody(tt.msg)
			if got != tt.want {
				t.Errorf("extractMessageBody() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDetectMediaMimetype(t *testing.T) {
	tests := []struct {
		name string
		msg  *waE2E.Message
		want string
	}{
		{"image", &waE2E.Message{ImageMessage: &waE2E.ImageMessage{Mimetype: proto.String("image/jpeg")}}, "image/jpeg"},
		{"video", &waE2E.Message{VideoMessage: &waE2E.VideoMessage{Mimetype: proto.String("video/mp4")}}, "video/mp4"},
		{"audio", &waE2E.Message{AudioMessage: &waE2E.AudioMessage{Mimetype: proto.String("audio/ogg")}}, "audio/ogg"},
		{"document", &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{Mimetype: proto.String("application/pdf")}}, "application/pdf"},
		{"sticker", &waE2E.Message{StickerMessage: &waE2E.StickerMessage{Mimetype: proto.String("image/webp")}}, "image/webp"},
		{"fallback", &waE2E.Message{}, "application/octet-stream"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := detectMediaMimetype(tt.msg)
			if got != tt.want {
				t.Errorf("detectMediaMimetype() = %q, want %q", got, tt.want)
			}
		})
	}
}

func strPtr(s string) *string {
	return &s
}
