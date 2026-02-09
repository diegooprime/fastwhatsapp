import {
  List,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  useNavigation,
  Color,
} from "@raycast/api";
import { useState, useEffect, useCallback } from "react";
import { api, Chat, ConnectionStatus } from "./api";
import { ChatView } from "./chat";
import { QRCodeView } from "./qr";

export default function Command() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [isLoading, setIsLoading] = useState(true);
  const { push } = useNavigation();

  const checkStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await api.getStatus();
      setStatus(response.status);

      if (response.ready) {
        await loadChats();
      } else if (response.status === "connecting") {
        setIsLoading(false);
        setTimeout(() => checkStatus(), 2000);
      } else {
        setIsLoading(false);
      }
    } catch {
      setStatus("disconnected");
      setIsLoading(false);
      showToast({
        style: Toast.Style.Failure,
        title: "Service Unavailable",
        message: "Make sure the WhatsApp service is running",
      });
    }
  }, []);

  async function loadChats() {
    try {
      const allChats = await api.getChats();
      const unread = allChats
        .filter((c) => c.unreadCount > 0)
        .sort((a, b) => (b.lastMessageTimestamp ?? 0) - (a.lastMessageTimestamp ?? 0));
      setChats(unread);
    } catch (error) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load chats",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  function formatTime(timestamp?: number): string {
    if (!timestamp) return "";
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

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return "yesterday";
    }

    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  }

  function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max) + "...";
  }

  async function openChatAndMarkRead(chat: Chat) {
    // Mark as read in background
    api.markRead(chat.id).catch(() => {
      // Silent fail — not critical
    });

    push(
      <ChatView
        contact={{
          id: chat.id,
          name: chat.name,
          number: chat.id.split("@")[0],
          isGroup: chat.isGroup,
        }}
      />
    );
  }

  // Not connected
  if (status !== "ready" && !isLoading) {
    return (
      <List>
        <List.EmptyView
          icon={status === "connecting" ? Icon.Clock : Icon.XMarkCircle}
          title={
            status === "qr"
              ? "QR Code Available"
              : status === "connecting"
                ? "Connecting..."
                : "WhatsApp Not Connected"
          }
          description={
            status === "qr"
              ? "Press Enter to scan the QR code"
              : status === "connecting"
                ? "Please wait, reconnecting automatically..."
                : "Make sure the WhatsApp service is running and authenticated"
          }
          actions={
            <ActionPanel>
              {status === "qr" && (
                <Action
                  title="Scan Qr Code"
                  icon={Icon.Camera}
                  onAction={() =>
                    push(<QRCodeView onAuthenticated={checkStatus} />)
                  }
                />
              )}
              <Action
                title="Refresh Status"
                icon={Icon.ArrowClockwise}
                onAction={() => {
                  showToast({ style: Toast.Style.Animated, title: "Checking connection..." });
                  checkStatus();
                }}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Filter unread chats..."
    >
      {chats.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.CheckCircle}
          title="All Caught Up"
          description="No unread messages"
          actions={
            <ActionPanel>
              <Action
                title="Refresh"
                icon={Icon.ArrowClockwise}
                onAction={() => {
                  setIsLoading(true);
                  loadChats();
                }}
              />
            </ActionPanel>
          }
        />
      ) : (
        chats.map((chat) => (
          <List.Item
            key={chat.id}
            title={chat.name}
            subtitle={chat.lastMessage ? truncate(chat.lastMessage, 60) : undefined}
            icon={chat.isGroup ? Icon.TwoPeople : Icon.Person}
            accessories={[
              {
                tag: {
                  value: String(chat.unreadCount),
                  color: Color.Green,
                },
              },
              {
                text: formatTime(chat.lastMessageTimestamp),
              },
            ]}
            actions={
              <ActionPanel>
                <Action
                  title="Open Chat"
                  icon={Icon.Message}
                  onAction={() => openChatAndMarkRead(chat)}
                />
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
                  onAction={() => {
                    setIsLoading(true);
                    loadChats();
                  }}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
