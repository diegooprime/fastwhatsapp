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
import { useState, useEffect, useCallback, useRef } from "react";
import { api, Contact, Message } from "./api";
import { MediaPreview } from "./media-preview";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

interface ChatViewProps {
  contact: Contact;
  highlightMessageId?: string;
  highlightTimestamp?: number;
}

export function ChatView({
  contact,
  highlightMessageId,
  highlightTimestamp,
}: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { push } = useNavigation();

  // Load cached messages first (instant), then refresh in background
  const loadMessages = useCallback(
    async (forceRefresh = false) => {
      try {
        // When navigating from search, show highlighted message first, then load latest
        if (highlightMessageId && highlightTimestamp && !forceRefresh) {
          setIsLoading(true);
          // Load 30 messages ending at the target timestamp (it will be near the top)
          const response = await api.getMessagesCached(
            contact.id,
            30,
            highlightTimestamp,
          );
          const msgs = response.messages;
          setMessages(msgs);
          setIsLoading(false);
          // Find the target message and set selection (messages are newest-first, same as display)
          const apiIdx = msgs.findIndex(
            (m: Message) => m.id === highlightMessageId,
          );
          if (apiIdx !== -1) {
            setSelectedIndex(apiIdx);
          }
          // Also load latest messages in background so the full conversation is visible
          try {
            const latest = await api.getMessagesCached(contact.id, 30);
            if (latest.messages.length > 0) {
              setMessages(latest.messages);
              setSelectedIndex(0);
            }
          } catch {
            // Keep showing highlighted messages if latest fetch fails
          }
          return;
        }

        if (forceRefresh) {
          // User manually requested refresh
          setIsRefreshing(true);
          const response = await api.getMessagesRefresh(contact.id, 30);
          setMessages(response.messages);
          setSelectedIndex(0);
          setIsRefreshing(false);
          return;
        }

        // First: try to get cached messages (instant)
        const cached = await api.getMessagesCached(contact.id, 30);

        if (cached.messages.length > 0) {
          // Show cached messages immediately
          setMessages(cached.messages);
          setIsLoading(false);

          // Then refresh in background
          setIsRefreshing(true);
          try {
            const fresh = await api.getMessagesRefresh(contact.id, 30);
            setMessages(fresh.messages);
          } catch {
            // Background refresh failed - cached data is still shown
          }
          setIsRefreshing(false);
        } else {
          // No cache - must fetch fresh (first time opening this chat)
          setIsLoading(true);
          const fresh = await api.getMessagesRefresh(contact.id, 30);
          setMessages(fresh.messages);
          setIsLoading(false);
        }
      } catch (error) {
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to load",
          message: error instanceof Error ? error.message : "Unknown error",
        });
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [contact.id, highlightMessageId, highlightTimestamp],
  );

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Auto-refresh: poll every 10s — check cache first, then sync from WhatsApp if stale
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const refreshCountRef = useRef(0);

  useEffect(() => {
    const updateMessages = (fresh: Message[]) => {
      const selectedMsg = messagesRef.current[selectedIndexRef.current];
      setMessages(fresh);
      if (selectedMsg) {
        const newIdx = fresh.findIndex((m) => m.id === selectedMsg.id);
        if (newIdx !== -1) setSelectedIndex(newIdx);
      }
    };

    const interval = setInterval(async () => {
      try {
        // First: quick cached check (instant DB read)
        const cached = await api.getMessagesCached(contact.id, 30);
        if (cached.messages.length === 0) return;

        const currentNewest = messagesRef.current[0]?.timestamp ?? 0;
        const cachedNewest = cached.messages[0]?.timestamp ?? 0;

        if (cachedNewest > currentNewest) {
          // New messages found in cache — update immediately
          updateMessages(cached.messages);
          refreshCountRef.current = 0;
        } else {
          // No new cached messages — every 3rd cycle, do a full sync from WhatsApp
          refreshCountRef.current++;
          if (refreshCountRef.current >= 5) {
            refreshCountRef.current = 0;
            const fresh = await api.getMessagesRefresh(contact.id, 30);
            if (fresh.messages.length > 0) {
              const freshNewest = fresh.messages[0]?.timestamp ?? 0;
              if (freshNewest > currentNewest) {
                updateMessages(fresh.messages);
              }
            }
          }
        }
      } catch {
        // Silent fail on auto-refresh
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [contact.id]);

  // Messages in newest-first order (API returns DESC) so latest are visible at top
  const displayMessages = messages;
  const currentMessage = displayMessages[selectedIndex];

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date
        .toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
        .toLowerCase();
    }

    return date
      .toLocaleDateString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
      .toLowerCase();
  }

  function goDown() {
    if (selectedIndex < displayMessages.length - 1) {
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

  async function handleImageView(
    msg: Message,
  ): Promise<{ mediaData: string; mediaType: "image" | "sticker" } | null> {
    // If mediaData already exists, use it
    if (msg.mediaData) {
      return {
        mediaData: msg.mediaData,
        mediaType: msg.mediaType as "image" | "sticker",
      };
    }

    // Validate message ID
    if (!msg.id) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Cannot load image",
        message: "Message ID is missing",
      });
      return null;
    }

    // Download on demand
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Loading image...",
      message: `ID: ${msg.id.slice(0, 20)}...`,
    });

    try {
      console.log(
        "Downloading media for message:",
        msg.id,
        "fromMe:",
        msg.fromMe,
      );
      const media = await api.downloadMedia(msg.id);
      if (!media || !media.data) {
        toast.style = Toast.Style.Failure;
        toast.title = "Image not available";
        toast.message = "Media may have expired or been deleted";
        return null;
      }
      toast.style = Toast.Style.Success;
      toast.title = "Image loaded";
      return {
        mediaData: `data:${media.mimetype};base64,${media.data}`,
        mediaType: msg.mediaType as "image" | "sticker",
      };
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to load image";
      const errorMsg = error instanceof Error ? error.message : String(error);
      toast.message =
        errorMsg.length > 100 ? errorMsg.slice(0, 100) + "..." : errorMsg;
      console.error("Image download error for ID:", msg.id, "Error:", error);
      return null;
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
    displayMessages.forEach((msg, idx) => {
      const time = formatTime(msg.timestamp);
      const sender = msg.fromMe
        ? "You"
        : msg.senderName
          ? msg.senderName.split(" ")[0]
          : contact.isGroup
            ? msg.from.split("@")[0] || "Member"
            : contact.name.split(" ")[0];
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

  const navTitle = isRefreshing
    ? `${contact.name} ↻`
    : `${contact.name} (${selectedIndex + 1}/${displayMessages.length})`;

  return (
    <Detail
      navigationTitle={navTitle}
      isLoading={isLoading}
      markdown={generateMarkdown()}
      actions={
        currentMessage ? (
          <ActionPanel>
            {/* Default action depends on message type */}
            {/* For images/stickers: Enter = View Image (downloads on demand if needed) */}
            {currentMessage.hasMedia &&
              (currentMessage.mediaType === "image" ||
                currentMessage.mediaType === "sticker") && (
                <Action
                  title="View Image"
                  icon={Icon.Eye}
                  onAction={async () => {
                    const result = await handleImageView(currentMessage);
                    if (result) {
                      push(
                        <MediaPreview
                          mediaData={result.mediaData}
                          mediaType={result.mediaType}
                          contactName={contact.name}
                          timestamp={currentMessage.timestamp}
                          messageId={currentMessage.id}
                        />,
                      );
                    }
                  }}
                />
              )}

            {/* For videos: Enter = Open Video */}
            {currentMessage.hasMedia &&
              currentMessage.mediaType === "video" && (
                <Action
                  title="Open Video"
                  icon={Icon.Video}
                  onAction={() => handleVideoOpen(currentMessage)}
                />
              )}

            {/* For text/other messages: Enter = Reply */}
            {!(
              (currentMessage.hasMedia &&
                (currentMessage.mediaType === "image" ||
                  currentMessage.mediaType === "sticker")) ||
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
              onAction={() => loadMessages(true)}
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

function ReplyToMessage({
  contact,
  quotedMessage,
  onSent,
}: ReplyToMessageProps) {
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
        text={`${quotedMessage.fromMe ? "You" : (quotedMessage.senderName || contact.name).split(" ")[0]}: ${quotedPreview}`}
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
