package main

import (
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
)

// getMediaType returns the media type string from a whatsmeow message
func getMediaType(msg *waE2E.Message) *string {
	if msg == nil {
		return nil
	}
	var t string
	switch {
	case msg.GetImageMessage() != nil:
		t = "image"
	case msg.GetVideoMessage() != nil:
		t = "video"
	case msg.GetAudioMessage() != nil:
		t = "audio"
	case msg.GetStickerMessage() != nil:
		t = "sticker"
	case msg.GetDocumentMessage() != nil:
		t = "document"
	default:
		return nil
	}
	return &t
}

// hasMediaContent returns true if the message contains downloadable media
func hasMediaContent(msg *waE2E.Message) bool {
	return getMediaType(msg) != nil
}

// extractMessageBody extracts the text body from a whatsmeow message
func extractMessageBody(msg *waE2E.Message) string {
	if msg == nil {
		return ""
	}
	if c := msg.GetConversation(); c != "" {
		return c
	}
	if ext := msg.GetExtendedTextMessage(); ext != nil {
		return ext.GetText()
	}
	if img := msg.GetImageMessage(); img != nil {
		return img.GetCaption()
	}
	if vid := msg.GetVideoMessage(); vid != nil {
		return vid.GetCaption()
	}
	if doc := msg.GetDocumentMessage(); doc != nil {
		return doc.GetCaption()
	}
	return ""
}

// detectMediaMimetype extracts the mimetype from a media message
func detectMediaMimetype(msg *waE2E.Message) string {
	if img := msg.GetImageMessage(); img != nil {
		return img.GetMimetype()
	}
	if vid := msg.GetVideoMessage(); vid != nil {
		return vid.GetMimetype()
	}
	if aud := msg.GetAudioMessage(); aud != nil {
		return aud.GetMimetype()
	}
	if doc := msg.GetDocumentMessage(); doc != nil {
		return doc.GetMimetype()
	}
	if stk := msg.GetStickerMessage(); stk != nil {
		return stk.GetMimetype()
	}
	return "application/octet-stream"
}
