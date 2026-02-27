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
import { useState, useEffect, useRef, useCallback } from "react";
import { api, SearchResult } from "./api";
import { ChatView } from "./chat";

export default function Command() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const { push } = useNavigation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performSearch = useCallback(async (query: string) => {
    if (query.trim().length === 0) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const searchResults = await api.searchMessages(query.trim());
      setResults(searchResults);
    } catch (error) {
      showToast({
        style: Toast.Style.Failure,
        title: "Search failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (searchText.trim().length === 0) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    debounceRef.current = setTimeout(() => {
      performSearch(searchText);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchText, performSearch]);

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

  return (
    <List
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search WhatsApp messages..."
      throttle
    >
      {searchText.trim().length === 0 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="Search Messages"
          description="Type to search across all WhatsApp messages"
        />
      ) : results.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="No Results"
          description={`No messages found for "${searchText}"`}
        />
      ) : (
        results.map((result) => (
          <List.Item
            key={result.id}
            title={truncate(result.body || "(media)", 80)}
            subtitle={result.chatName}
            icon={Icon.SpeechBubble}
            accessories={[
              ...(result.fromMe
                ? [{ tag: { value: "You", color: Color.Blue } }]
                : []),
              { text: formatTime(result.timestamp) },
            ]}
            actions={
              <ActionPanel>
                <Action
                  title="Open Chat"
                  icon={Icon.Message}
                  onAction={() =>
                    push(
                      <ChatView
                        contact={{
                          id: result.chatJid,
                          name: result.chatName,
                          number: result.chatJid.split("@")[0],
                          isGroup: result.chatJid.includes("@g.us"),
                        }}
                        highlightMessageId={result.id}
                        highlightTimestamp={result.timestamp}
                      />,
                    )
                  }
                />
                {result.body && (
                  <Action.CopyToClipboard
                    title="Copy Message"
                    content={result.body}
                    shortcut={{ modifiers: ["cmd"], key: "c" }}
                  />
                )}
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
