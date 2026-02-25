package main

import (
	"strings"

	"go.mau.fi/whatsmeow/types"
)

// toAPIJID converts a whatsmeow JID to API format (@c.us)
func toAPIJID(jid types.JID) string {
	if jid.Server == types.DefaultUserServer {
		return jid.User + "@c.us"
	}
	if jid.Server == types.GroupServer {
		return jid.User + "@g.us"
	}
	return jid.String()
}

// toAPIJIDString converts a JID string to API format
func toAPIJIDString(jid string) string {
	if strings.HasSuffix(jid, "@s.whatsapp.net") {
		return strings.TrimSuffix(jid, "@s.whatsapp.net") + "@c.us"
	}
	return jid
}

// toInternalJID converts API JID (@c.us) to internal format (@s.whatsapp.net)
func toInternalJID(apiJID string) string {
	if strings.HasSuffix(apiJID, "@c.us") {
		return strings.TrimSuffix(apiJID, "@c.us") + "@s.whatsapp.net"
	}
	return apiJID
}

// parseAPIJID converts an API JID string to a whatsmeow JID
func parseAPIJID(id string) types.JID {
	id = strings.Replace(id, "@c.us", "@s.whatsapp.net", 1)
	jid, _ := types.ParseJID(id)
	return jid
}

// extractNumber extracts the phone number from a JID string
func extractNumber(jid string) string {
	at := strings.Index(jid, "@")
	if at == -1 {
		return jid
	}
	return jid[:at]
}

// parseMessageIDParts parses a formatted message ID into its components.
// Format: "{fromMe}_{chatJID}_{messageID}"
// Example: "true_1234567890@c.us_3EB0ABCDEF"
func parseMessageIDParts(id string) *msgIDParts {
	firstUnderscore := strings.Index(id, "_")
	if firstUnderscore == -1 {
		return nil
	}
	fromMeStr := id[:firstUnderscore]
	rest := id[firstUnderscore+1:]

	// Find the @domain boundary to split chatJID from messageID
	var chatJID, messageID string
	for _, domain := range []string{"@c.us_", "@g.us_", "@s.whatsapp.net_"} {
		idx := strings.Index(rest, domain)
		if idx != -1 {
			chatJID = rest[:idx+len(domain)-1] // -1 to exclude trailing _
			messageID = rest[idx+len(domain):]
			break
		}
	}

	if chatJID == "" || messageID == "" {
		return nil
	}

	return &msgIDParts{
		fromMe:    fromMeStr == "true",
		chatJID:   chatJID,
		messageID: messageID,
	}
}

// formatMessageID constructs a formatted message ID compatible with whatsapp-web.js
func formatMessageID(fromMe bool, chatJID, messageID string) string {
	f := "false"
	if fromMe {
		f = "true"
	}
	return f + "_" + chatJID + "_" + messageID
}
