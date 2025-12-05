import {
  Form,
  ActionPanel,
  Action,
  showToast,
  Toast,
  useNavigation,
  Icon,
  Clipboard,
} from "@raycast/api";
import { useState, useEffect } from "react";
import { api, Contact } from "./api";

interface ComposeMessageProps {
  contact: Contact;
}

export function ComposeMessage({ contact }: ComposeMessageProps) {
  const [message, setMessage] = useState("");
  const [hasClipboardImage, setHasClipboardImage] = useState(false);
  const [attachImage, setAttachImage] = useState(false);
  const [clipboardImageData, setClipboardImageData] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const { pop } = useNavigation();

  useEffect(() => {
    checkClipboard();
  }, []);

  async function checkClipboard() {
    try {
      const clipboard = await Clipboard.read();
      if (clipboard.file) {
        // Check if it's an image
        const data = await Clipboard.readText();
        // Try to get image data
        setHasClipboardImage(true);
        // Store base64 if available - Raycast clipboard API
        if (clipboard.file) {
          // Read as base64
          const fs = await import("fs");
          const imageBuffer = fs.readFileSync(clipboard.file);
          const base64 = imageBuffer.toString("base64");
          const ext = clipboard.file.split(".").pop()?.toLowerCase() || "png";
          const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
          setClipboardImageData(`data:${mimeType};base64,${base64}`);
        }
      }
    } catch {
      // No image in clipboard
      setHasClipboardImage(false);
    }
  }

  async function handleSubmit() {
    if (!message.trim() && !attachImage) {
      showToast({
        style: Toast.Style.Failure,
        title: "Message Required",
        message: "Please enter a message",
      });
      return;
    }

    setIsSending(true);

    try {
      if (attachImage && clipboardImageData) {
        await api.sendImage(contact.id, clipboardImageData, message.trim() || undefined);
        showToast({
          style: Toast.Style.Success,
          title: "Image Sent",
          message: `Sent to ${contact.name}`,
        });
      } else {
        await api.sendMessage(contact.id, message.trim());
        showToast({
          style: Toast.Style.Success,
          title: "Message Sent",
          message: `Sent to ${contact.name}`,
        });
      }
      pop();
    } catch (error: any) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to Send",
        message: error.message,
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Form
      navigationTitle={`Message ${contact.name}`}
      isLoading={isSending}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Send Message"
            icon={Icon.Message}
            onSubmit={handleSubmit}
          />
          <Action
            title="Refresh Clipboard"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={checkClipboard}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="To" text={`${contact.name} (${contact.number})`} />
      
      <Form.TextArea
        id="message"
        title="Message"
        placeholder="Type your message..."
        value={message}
        onChange={setMessage}
        enableMarkdown={false}
      />

      {hasClipboardImage && (
        <Form.Checkbox
          id="attachImage"
          label="Attach clipboard image"
          value={attachImage}
          onChange={setAttachImage}
        />
      )}

      {attachImage && (
        <Form.Description
          title="Image"
          text="📷 Image from clipboard will be attached"
        />
      )}
    </Form>
  );
}
