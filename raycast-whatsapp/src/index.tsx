import {
  List,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useState, useEffect, useMemo, useCallback } from "react";
import { api, Contact, ConnectionStatus } from "./api";
import { getFavoriteContacts } from "./preferences";
import { ChatView } from "./chat";
import { QRCodeView } from "./qr";

export default function Command() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { push } = useNavigation();

  const favoriteNames = useMemo(() => getFavoriteContacts(), []);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    setIsLoading(true);
    try {
      const response = await api.getStatus();
      setStatus(response.status);

      if (response.ready) {
        await loadContacts();
      } else if (response.status === "connecting") {
        // Auto-retry after 2 seconds if connecting
        setIsLoading(false);
        setTimeout(() => checkStatus(), 2000);
      } else {
        setIsLoading(false);
      }
    } catch (error) {
      setStatus("disconnected");
      setIsLoading(false);
      showToast({
        style: Toast.Style.Failure,
        title: "Service Unavailable",
        message: "Make sure the WhatsApp service is running",
      });
    }
  }

  async function loadContacts() {
    try {
      const allContacts = await api.getContacts();
      setContacts(allContacts);
    } catch (error) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load contacts",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  }

  // Filter and sort contacts - only show favorites unless searching
  const { favorites, others } = useMemo(() => {
    const isSearching = searchText.length > 0;

    // Check if contact matches any favorite name, returns the index for ordering
    const getFavoriteIndex = (contact: Contact): number => {
      const index = favoriteNames.findIndex((fav) =>
        contact.name.toLowerCase().includes(fav)
      );
      return index;
    };

    const favs: { contact: Contact; index: number }[] = [];
    const rest: Contact[] = [];

    contacts.forEach((contact) => {
      const favIndex = getFavoriteIndex(contact);
      if (favIndex !== -1) {
        // Always include favorites if they match search (or no search)
        if (
          !isSearching ||
          contact.name.toLowerCase().includes(searchText.toLowerCase())
        ) {
          favs.push({ contact, index: favIndex });
        }
      } else if (isSearching) {
        // Only show non-favorites when searching
        if (
          contact.name.toLowerCase().includes(searchText.toLowerCase()) ||
          contact.number.includes(searchText)
        ) {
          rest.push(contact);
        }
      }
    });

    // Sort favorites by their config order
    favs.sort((a, b) => a.index - b.index);

    return { favorites: favs.map((f) => f.contact), others: rest };
  }, [contacts, searchText, favoriteNames]);

  // Flat list of all visible contact IDs for navigation
  const allVisibleIds = useMemo(() => {
    return [...favorites.map((c) => c.id), ...others.map((c) => c.id)];
  }, [favorites, others]);

  const goDown = useCallback(() => {
    if (allVisibleIds.length === 0) return;
    const currentIndex = selectedId ? allVisibleIds.indexOf(selectedId) : -1;
    const nextIndex = currentIndex < allVisibleIds.length - 1 ? currentIndex + 1 : 0;
    setSelectedId(allVisibleIds[nextIndex]);
  }, [allVisibleIds, selectedId]);

  const goUp = useCallback(() => {
    if (allVisibleIds.length === 0) return;
    const currentIndex = selectedId ? allVisibleIds.indexOf(selectedId) : 0;
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : allVisibleIds.length - 1;
    setSelectedId(allVisibleIds[prevIndex]);
  }, [allVisibleIds, selectedId]);

  function ContactItem({ contact }: { contact: Contact }) {
    return (
      <List.Item
        id={contact.id}
        key={contact.id}
        title={contact.name}
        subtitle={contact.isGroup ? "Group" : undefined}
        icon={contact.isGroup ? Icon.TwoPeople : Icon.Person}
        actions={
          <ActionPanel>
            <Action.Push
              title="Open Chat"
              icon={Icon.Message}
              target={<ChatView contact={contact} />}
            />
            <Action
              title="Next Contact"
              icon={Icon.ArrowDown}
              shortcut={{ modifiers: [], key: "j" }}
              onAction={goDown}
            />
            <Action
              title="Previous Contact"
              icon={Icon.ArrowUp}
              shortcut={{ modifiers: [], key: "k" }}
              onAction={goUp}
            />
          </ActionPanel>
        }
      />
    );
  }

  // Not connected state
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
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search contacts..."
      selectedItemId={selectedId ?? undefined}
      onSelectionChange={setSelectedId}
    >
      {favorites.length > 0 && (
        <List.Section title="Favorites">
          {favorites.map((contact) => (
            <ContactItem key={contact.id} contact={contact} />
          ))}
        </List.Section>
      )}

      {others.length > 0 && (
        <List.Section title={favorites.length > 0 ? "All Contacts" : undefined}>
          {others.map((contact) => (
            <ContactItem key={contact.id} contact={contact} />
          ))}
        </List.Section>
      )}

      {contacts.length === 0 && !isLoading && (
        <List.EmptyView
          icon={Icon.Person}
          title="No Contacts Found"
          description="Your WhatsApp contacts will appear here"
        />
      )}
    </List>
  );
}
