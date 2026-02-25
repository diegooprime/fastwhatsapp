package main

import (
	"testing"

	"go.mau.fi/whatsmeow/types"
)

func TestToAPIJID(t *testing.T) {
	tests := []struct {
		name string
		jid  types.JID
		want string
	}{
		{
			name: "default user server to @c.us",
			jid:  types.JID{User: "10000000001", Server: types.DefaultUserServer},
			want: "10000000001@c.us",
		},
		{
			name: "group server stays @g.us",
			jid:  types.JID{User: "120363000000000000", Server: types.GroupServer},
			want: "120363000000000000@g.us",
		},
		{
			name: "unknown server uses String()",
			jid:  types.JID{User: "1234", Server: "lid"},
			want: "1234@lid",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := toAPIJID(tt.jid)
			if got != tt.want {
				t.Errorf("toAPIJID() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestToAPIJIDString(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"10000000001@s.whatsapp.net", "10000000001@c.us"},
		{"10000000001@c.us", "10000000001@c.us"},
		{"120363000000000000@g.us", "120363000000000000@g.us"},
		{"1234@lid", "1234@lid"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := toAPIJIDString(tt.input)
			if got != tt.want {
				t.Errorf("toAPIJIDString(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestToInternalJID(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"10000000001@c.us", "10000000001@s.whatsapp.net"},
		{"10000000001@s.whatsapp.net", "10000000001@s.whatsapp.net"},
		{"120363000000000000@g.us", "120363000000000000@g.us"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := toInternalJID(tt.input)
			if got != tt.want {
				t.Errorf("toInternalJID(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestExtractNumber(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"10000000001@s.whatsapp.net", "10000000001"},
		{"10000000001@c.us", "10000000001"},
		{"nojid", "nojid"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := extractNumber(tt.input)
			if got != tt.want {
				t.Errorf("extractNumber(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseMessageIDParts(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantNil   bool
		wantParts *msgIDParts
	}{
		{
			name:  "valid outgoing @c.us message",
			input: "true_10000000001@c.us_3EB0ABCDEF",
			wantParts: &msgIDParts{
				fromMe:    true,
				chatJID:   "10000000001@c.us",
				messageID: "3EB0ABCDEF",
			},
		},
		{
			name:  "valid incoming @g.us message",
			input: "false_120363000000000000@g.us_ABCDEF123456",
			wantParts: &msgIDParts{
				fromMe:    false,
				chatJID:   "120363000000000000@g.us",
				messageID: "ABCDEF123456",
			},
		},
		{
			name:  "valid @s.whatsapp.net message",
			input: "true_10000000001@s.whatsapp.net_MSG123",
			wantParts: &msgIDParts{
				fromMe:    true,
				chatJID:   "10000000001@s.whatsapp.net",
				messageID: "MSG123",
			},
		},
		{
			name:    "missing underscore",
			input:   "trueSOMEJUNK",
			wantNil: true,
		},
		{
			name:    "no domain separator",
			input:   "true_nodomain_MSGID",
			wantNil: true,
		},
		{
			name:    "empty string",
			input:   "",
			wantNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseMessageIDParts(tt.input)
			if tt.wantNil {
				if got != nil {
					t.Errorf("parseMessageIDParts(%q) = %+v, want nil", tt.input, got)
				}
				return
			}
			if got == nil {
				t.Fatalf("parseMessageIDParts(%q) = nil, want non-nil", tt.input)
			}
			if got.fromMe != tt.wantParts.fromMe {
				t.Errorf("fromMe = %v, want %v", got.fromMe, tt.wantParts.fromMe)
			}
			if got.chatJID != tt.wantParts.chatJID {
				t.Errorf("chatJID = %q, want %q", got.chatJID, tt.wantParts.chatJID)
			}
			if got.messageID != tt.wantParts.messageID {
				t.Errorf("messageID = %q, want %q", got.messageID, tt.wantParts.messageID)
			}
		})
	}
}

func TestFormatMessageID(t *testing.T) {
	tests := []struct {
		fromMe    bool
		chatJID   string
		messageID string
		want      string
	}{
		{true, "10000000001@c.us", "3EB0ABCDEF", "true_10000000001@c.us_3EB0ABCDEF"},
		{false, "120363000000000000@g.us", "MSGID", "false_120363000000000000@g.us_MSGID"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			got := formatMessageID(tt.fromMe, tt.chatJID, tt.messageID)
			if got != tt.want {
				t.Errorf("formatMessageID() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFormatAndParseRoundTrip(t *testing.T) {
	// Ensure format -> parse round-trips correctly
	cases := []struct {
		fromMe    bool
		chatJID   string
		messageID string
	}{
		{true, "10000000001@c.us", "3EB0ABCDEF123"},
		{false, "120363000000000000@g.us", "DEADBEEF"},
	}

	for _, c := range cases {
		formatted := formatMessageID(c.fromMe, c.chatJID, c.messageID)
		parsed := parseMessageIDParts(formatted)
		if parsed == nil {
			t.Fatalf("round-trip failed: parseMessageIDParts(%q) = nil", formatted)
		}
		if parsed.fromMe != c.fromMe || parsed.chatJID != c.chatJID || parsed.messageID != c.messageID {
			t.Errorf("round-trip mismatch: got {%v, %q, %q}, want {%v, %q, %q}",
				parsed.fromMe, parsed.chatJID, parsed.messageID,
				c.fromMe, c.chatJID, c.messageID)
		}
	}
}
