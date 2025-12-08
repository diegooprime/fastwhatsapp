import {
  Detail,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  Clipboard,
  Form,
  useNavigation,
} from "@raycast/api";
import { useState, useEffect, useCallback, useMemo } from "react";
import { api, Contact, Message } from "./api";
import { MediaPreview } from "./media-preview";

interface ChatViewProps {
  contact: Contact;
}

export function ChatView({ contact }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Find last 10 messages with previewable media (images and stickers)
  const previewableMedia = useMemo(() => {
    return messages
      .filter(
        (msg) =>
          msg.hasMedia &&
          (msg.mediaType === "image" || msg.mediaType === "sticker") &&
          msg.mediaData
      )
      .slice(0, 10); // Limit to last 10 images
  }, [messages]);

  const loadMessages = useCallback(async () => {
    setIsLoading(true);
    try {
      const msgs = await api.getMessages(contact.id, 20); // Fetch enough to find images without too much lag
      setMessages(msgs);
    } catch (error) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  }, [contact.id]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).toLowerCase();
    }

    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).toLowerCase();
  }

  function generateMarkdown(): string {
    if (messages.length === 0 && !isLoading) {
      return `# ${contact.name}\n\n*No messages yet*`;
    }

    let md = `# ${contact.name}\n\n`;

    // Reverse to show most recent messages at the top
    [...messages].reverse().forEach((msg) => {
      const time = formatTime(msg.timestamp);
      const sender = msg.fromMe ? "Me" : contact.name.split(" ")[0];

      // Build message content
      let content = "";
      
      // Handle media - just show icon
      if (msg.hasMedia) {
        const mediaType = msg.mediaType || "unknown";
        switch (mediaType) {
          case "image":
          case "sticker":
            content += "📸";
            break;
          case "video":
            content += "🎥";
            break;
          case "audio":
            content += "🔊";
            break;
          default:
            content += "📎";
            break;
        }
      }

      // Add text if available
      if (msg.body) {
        if (content) content += " ";
        content += msg.body;
      }

      md += `\`${time}\` **${sender}** | ${content}\n\n`;
    });

    return md;
  }

  return (
    <Detail
      navigationTitle={contact.name}
      isLoading={isLoading}
      markdown={generateMarkdown()}
      actions={
        <ActionPanel>
          <Action.Push
            title="Send Message"
            icon={Icon.Message}
            target={<ComposeInline contact={contact} onSent={loadMessages} />}
          />
          {previewableMedia.length > 0 && (
            <ActionPanel.Submenu
              title={`See media (${previewableMedia.length})`}
              icon={Icon.Eye}
              shortcut={{ modifiers: ["cmd"], key: "return" }}
            >
              {[...previewableMedia].reverse().map((msg) => (
                <Action.Push
                  key={msg.id}
                  title={formatTime(msg.timestamp)}
                  icon={msg.mediaType === "sticker" ? Icon.Stars : Icon.Image}
                  target={
                    <MediaPreview
                      mediaData={msg.mediaData!}
                      mediaType={msg.mediaType as "image" | "sticker"}
                      contactName={contact.name}
                      timestamp={msg.timestamp}
                      messageId={msg.id}
                    />
                  }
                />
              ))}
            </ActionPanel.Submenu>
          )}
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            onAction={loadMessages}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
          />
        </ActionPanel>
      }
    />
  );
}

interface ComposeInlineProps {
  contact: Contact;
  onSent: () => void;
}

function ComposeInline({ contact, onSent }: ComposeInlineProps) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [imageData, setImageData] = useState<string | null>(null);
  const { pop } = useNavigation();

  async function handlePaste() {
    try {
      const { execSync } = await import("child_process");
      const fs = await import("fs");
      const os = await import("os");
      const path = await import("path");

      // Try to get image from system clipboard using pngpaste
      const tmpFile = path.join(os.tmpdir(), `raycast-wa-${Date.now()}.png`);

      try {
        // Try using osascript to save clipboard image to file
        execSync(
          `osascript -e 'try
          set theFile to POSIX file "${tmpFile}"
          set imgData to the clipboard as «class PNGf»
          set fileRef to open for access theFile with write permission
          write imgData to fileRef
          close access fileRef
          return "ok"
        on error
          return "no image"
        end try'`,
          { encoding: "utf-8" },
        );

        if (fs.existsSync(tmpFile) && fs.statSync(tmpFile).size > 0) {
          const buffer = fs.readFileSync(tmpFile);
          const base64 = `data:image/png;base64,${buffer.toString("base64")}`;
          fs.unlinkSync(tmpFile); // Clean up
          setImageData(base64);
          showToast({
            style: Toast.Style.Success,
            title: "📷 Image ready to send",
          });
          return;
        }
      } catch {
        // osascript failed, try Raycast clipboard
      }

      // Fallback to Raycast clipboard API
      const clipboard = await Clipboard.read();

      if (clipboard.file) {
        if (fs.existsSync(clipboard.file)) {
          const buffer = fs.readFileSync(clipboard.file);
          const ext = clipboard.file.split(".").pop()?.toLowerCase() || "png";

          if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
            const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
            const base64 = `data:${mime};base64,${buffer.toString("base64")}`;
            setImageData(base64);
            showToast({
              style: Toast.Style.Success,
              title: "📷 Image ready to send",
            });
            return;
          }
        }
      }

      // Only paste text if NO image was found
      if (clipboard.text) {
        // Skip if text looks like image metadata
        if (clipboard.text.match(/^Image\s*\(\d+×\d+\)$/i)) {
          showToast({
            style: Toast.Style.Failure,
            title: "No image found in clipboard",
          });
          return;
        }
        setMessage((prev) => prev + clipboard.text);
      }
    } catch (e) {
      showToast({ style: Toast.Style.Failure, title: "Nothing to paste" });
    }
  }

  function clearImage() {
    setImageData(null);
    showToast({ style: Toast.Style.Success, title: "Image removed" });
  }

  async function handleSubmit() {
    const hasText = message.trim().length > 0;
    const hasImage = imageData !== null;

    if (!hasText && !hasImage) {
      showToast({
        style: Toast.Style.Failure,
        title: "Enter a message or paste an image (⌘V)",
      });
      return;
    }

    setIsSending(true);
    try {
      if (hasImage) {
        await api.sendImage(
          contact.id,
          imageData!,
          message.trim() || undefined,
        );
        showToast({ style: Toast.Style.Success, title: "Image sent!" });
      } else {
        await api.sendMessage(contact.id, message.trim());
        showToast({ style: Toast.Style.Success, title: "Sent!" });
      }

      onSent();
      pop();
    } catch (error) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Form
      navigationTitle={`→ ${contact.name}`}
      isLoading={isSending}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Send"
            icon={Icon.Message}
            onSubmit={handleSubmit}
            shortcut={{ modifiers: ["cmd"], key: "return" }}
          />
          <Action
            title="Paste"
            icon={Icon.Clipboard}
            onAction={handlePaste}
            shortcut={{ modifiers: ["cmd"], key: "v" }}
          />
          {imageData && (
            <Action
              title="Remove Image"
              icon={Icon.Trash}
              onAction={clearImage}
              shortcut={{ modifiers: ["cmd"], key: "backspace" }}
            />
          )}
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="message"
        title=""
        placeholder={
          imageData
            ? "Add caption (optional)..."
            : "Type a message or paste image (⌘V)..."
        }
        value={message}
        onChange={setMessage}
        autoFocus
      />

      {imageData && (
        <Form.Description title="📷" text="Image attached — ready to send" />
      )}
    </Form>
  );
}
