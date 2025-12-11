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
  Color,
} from "@raycast/api";
import { useState, useEffect, useCallback } from "react";
import { api, Contact, Message } from "./api";
import { MediaPreview } from "./media-preview";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

interface ChatViewProps {
  contact: Contact;
}

export function ChatView({ contact }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { push } = useNavigation();

  const loadMessages = useCallback(async () => {
    setIsLoading(true);
    try {
      const msgs = await api.getMessages(contact.id, 30);
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

  // Messages reversed so index 0 = newest (top)
  const reversedMessages = [...messages].reverse();
  const currentMessage = reversedMessages[selectedIndex];

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

  function goDown() {
    if (selectedIndex < reversedMessages.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
  }

  function goUp() {
    if (selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
  }

  async function handleVideoOpen(msg: Message) {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Downloading video...",
    });

    try {
      const media = await api.downloadMedia(msg.id);

      let ext = "mp4";
      if (media.mimetype.includes("webm")) ext = "webm";
      else if (media.mimetype.includes("mov")) ext = "mov";
      else if (media.mimetype.includes("avi")) ext = "avi";

      const tmpFile = path.join(os.tmpdir(), `wa-video-${Date.now()}.${ext}`);
      const buffer = Buffer.from(media.data, "base64");
      fs.writeFileSync(tmpFile, new Uint8Array(buffer));

      try {
        execSync(`open -a "IINA" "${tmpFile}"`);
      } catch {
        execSync(`open "${tmpFile}"`);
      }

      toast.style = Toast.Style.Success;
      toast.title = "Video opened";
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to open video";
      toast.message = error instanceof Error ? error.message : "Unknown error";
    }
  }

  function generateMarkdown(): string {
    if (messages.length === 0 && !isLoading) {
      return `# ${contact.name}\n\n*No messages yet*`;
    }

    if (!currentMessage) {
      return `# ${contact.name}\n\n*Loading...*`;
    }

    let md = "";

    // Show all messages with current one highlighted
    reversedMessages.forEach((msg, idx) => {
      const time = formatTime(msg.timestamp);
      const sender = msg.fromMe ? "You" : contact.name.split(" ")[0];
      const isSelected = idx === selectedIndex;

      let content = "";
      if (msg.hasMedia) {
        switch (msg.mediaType) {
          case "image":
          case "sticker":
            content = "📸";
            break;
          case "video":
            content = "🎥";
            break;
          case "audio":
            content = "🔊";
            break;
          default:
            content = "📎";
            break;
        }
      }
      if (msg.body) {
        if (content) content += " ";
        content += msg.body;
      }
      if (!content) content = "(empty)";

      if (isSelected) {
        md += `▶ \`${time}\` **${sender}**: ${content}\n\n`;
      } else {
        md += `\`${time}\` ${sender}: ${content}\n\n`;
      }
    });

    return md;
  }

  return (
    <Detail
      navigationTitle={`${contact.name} (${selectedIndex + 1}/${reversedMessages.length})`}
      isLoading={isLoading}
      markdown={generateMarkdown()}
      actions={
        currentMessage ? (
          <ActionPanel>
            {/* Default action depends on message type */}
            {/* For images/stickers: Enter = View Image */}
            {currentMessage.hasMedia && (currentMessage.mediaType === "image" || currentMessage.mediaType === "sticker") && currentMessage.mediaData && (
              <Action.Push
                title="View Image"
                icon={Icon.Eye}
                target={
                  <MediaPreview
                    mediaData={currentMessage.mediaData}
                    mediaType={currentMessage.mediaType as "image" | "sticker"}
                    contactName={contact.name}
                    timestamp={currentMessage.timestamp}
                    messageId={currentMessage.id}
                  />
                }
              />
            )}

            {/* For videos: Enter = Open Video */}
            {currentMessage.hasMedia && currentMessage.mediaType === "video" && (
              <Action
                title="Open Video"
                icon={Icon.Video}
                onAction={() => handleVideoOpen(currentMessage)}
              />
            )}

            {/* For text/other messages: Enter = Reply */}
            {!(
              (currentMessage.hasMedia && (currentMessage.mediaType === "image" || currentMessage.mediaType === "sticker") && currentMessage.mediaData) ||
              (currentMessage.hasMedia && currentMessage.mediaType === "video")
            ) && (
              <Action.Push
                title="Reply"
                icon={Icon.Reply}
                target={
                  <ReplyToMessage
                    contact={contact}
                    quotedMessage={currentMessage}
                    onSent={loadMessages}
                  />
                }
              />
            )}

            {/* Cmd+Enter = Send new message */}
            <Action.Push
              title="Send New Message"
              icon={Icon.Message}
              shortcut={{ modifiers: ["cmd"], key: "return" }}
              target={<ComposeInline contact={contact} onSent={loadMessages} />}
            />

            {/* Cmd+R = Reply (always available) */}
            <Action.Push
              title="Reply to This"
              icon={Icon.Reply}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              target={
                <ReplyToMessage
                  contact={contact}
                  quotedMessage={currentMessage}
                  onSent={loadMessages}
                />
              }
            />

            {/* Navigation */}
            <Action
              title="Next Message"
              icon={Icon.ArrowDown}
              shortcut={{ modifiers: [], key: "j" }}
              onAction={goDown}
            />
            <Action
              title="Previous Message"
              icon={Icon.ArrowUp}
              shortcut={{ modifiers: [], key: "k" }}
              onAction={goUp}
            />

            {currentMessage.body && (
              <Action.CopyToClipboard
                title="Copy Message"
                content={currentMessage.body}
                shortcut={{ modifiers: ["cmd"], key: "c" }}
              />
            )}

            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              onAction={loadMessages}
              shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
            />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}

interface ReplyToMessageProps {
  contact: Contact;
  quotedMessage: Message;
  onSent: () => void;
}

function ReplyToMessage({ contact, quotedMessage, onSent }: ReplyToMessageProps) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const { pop } = useNavigation();

  const quotedPreview = quotedMessage.body
    ? quotedMessage.body.length > 50
      ? quotedMessage.body.slice(0, 50) + "..."
      : quotedMessage.body
    : quotedMessage.hasMedia
      ? `[${quotedMessage.mediaType || "media"}]`
      : "(empty)";

  async function handleSubmit() {
    if (!message.trim()) {
      showToast({
        style: Toast.Style.Failure,
        title: "Enter a message",
      });
      return;
    }

    setIsSending(true);
    try {
      await api.sendMessage(contact.id, message.trim(), quotedMessage.id);
      showToast({ style: Toast.Style.Success, title: "Reply sent!" });
      onSent();
      pop();
    } catch (error) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to send",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Form
      navigationTitle={`Reply to ${contact.name}`}
      isLoading={isSending}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Send Reply"
            icon={Icon.Reply}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Replying to"
        text={`${quotedMessage.fromMe ? "You" : contact.name.split(" ")[0]}: ${quotedPreview}`}
      />
      <Form.TextArea
        id="message"
        title=""
        placeholder="Type your reply..."
        value={message}
        onChange={setMessage}
        autoFocus
      />
    </Form>
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

      const tmpFile = path.join(os.tmpdir(), `raycast-wa-${Date.now()}.png`);

      try {
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
          fs.unlinkSync(tmpFile);
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

      if (clipboard.text) {
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
