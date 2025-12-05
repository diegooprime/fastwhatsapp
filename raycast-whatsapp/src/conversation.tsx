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
import { useState, useEffect } from "react";
import { api, Contact, Message } from "./api";
import { ComposeMessage } from "./compose";

interface ConversationViewProps {
  contact: Contact;
}

export function ConversationView({ contact }: ConversationViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { push } = useNavigation();

  useEffect(() => {
    loadMessages();
  }, [contact.id]);

  async function loadMessages() {
    setIsLoading(true);
    try {
      const msgs = await api.getMessages(contact.id, 10);
      // Reverse to show oldest first (bottom to top in typical chat UX)
      setMessages(msgs.reverse());
    } catch (error: any) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load messages",
        message: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    
    return date.toLocaleDateString([], { 
      month: "short", 
      day: "numeric",
      hour: "2-digit", 
      minute: "2-digit" 
    });
  }

  return (
    <List
      navigationTitle={`Chat with ${contact.name}`}
      isLoading={isLoading}
    >
      {messages.map((msg, index) => (
        <List.Item
          key={msg.id || index}
          title={msg.body || "[Media]"}
          subtitle={formatTime(msg.timestamp)}
          icon={msg.fromMe ? Icon.ArrowRight : Icon.ArrowLeft}
          accessories={[
            {
              tag: {
                value: msg.fromMe ? "You" : contact.name.split(" ")[0],
                color: msg.fromMe ? Color.Blue : Color.Green,
              },
            },
          ]}
          actions={
            <ActionPanel>
              <Action
                title="Reply"
                icon={Icon.Reply}
                onAction={() => push(<ComposeMessage contact={contact} />)}
              />
              <Action
                title="Refresh"
                icon={Icon.ArrowClockwise}
                onAction={loadMessages}
                shortcut={{ modifiers: ["cmd"], key: "r" }}
              />
              <Action.CopyToClipboard
                title="Copy Message"
                content={msg.body}
                shortcut={{ modifiers: ["cmd"], key: "c" }}
              />
            </ActionPanel>
          }
        />
      ))}

      {messages.length === 0 && !isLoading && (
        <List.EmptyView
          icon={Icon.Message}
          title="No Messages"
          description="Start a conversation"
          actions={
            <ActionPanel>
              <Action
                title="Send Message"
                icon={Icon.Message}
                onAction={() => push(<ComposeMessage contact={contact} />)}
              />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}
