import {
  List,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useState, useEffect, useMemo } from "react";
import { api, Contact, ConnectionStatus } from "./api";
import { getFavoriteContacts } from "./preferences";
import { ChatView } from "./chat";
import { QRCodeView } from "./qr";

export default function Command() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const { push } = useNavigation();

  const favoriteNames = useMemo(() => getFavoriteContacts(), []);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    try {
      const response = await api.getStatus();
      setStatus(response.status);

      if (response.ready) {
        await loadContacts();
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
    } catch (error: any) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load contacts",
        message: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  // Filter and sort contacts - only show favorites unless searching
  const { favorites, others } = useMemo(() => {
    const isSearching = searchText.length > 0;
    
    // Check if contact matches any favorite name
    const isFavorite = (contact: Contact) =>
      favoriteNames.some((fav) => contact.name.toLowerCase().includes(fav));

    const favs: Contact[] = [];
    const rest: Contact[] = [];

    contacts.forEach((contact) => {
      if (isFavorite(contact)) {
        // Always include favorites if they match search (or no search)
        if (!isSearching || contact.name.toLowerCase().includes(searchText.toLowerCase())) {
          favs.push(contact);
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

    return { favorites: favs, others: rest };
  }, [contacts, searchText, favoriteNames]);

  function ContactItem({ contact }: { contact: Contact }) {
    return (
      <List.Item
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
            {!contact.isGroup && (
              <Action.OpenInBrowser
                title="Video Call"
                icon={Icon.Video}
                url={`https://wa.me/${contact.number}?video=1`}
                shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
              />
            )}
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
          icon={Icon.XMarkCircle}
          title={status === "qr" ? "QR Code Available" : "WhatsApp Not Connected"}
          description={
            status === "qr"
              ? "Press Enter to scan the QR code"
              : status === "connecting"
              ? "Connecting to WhatsApp..."
              : "Make sure the WhatsApp service is running and authenticated"
          }
          actions={
            <ActionPanel>
              {status === "qr" && (
                <Action
                  title="Scan QR Code"
                  icon={Icon.Camera}
                  onAction={() => push(<QRCodeView onAuthenticated={checkStatus} />)}
                />
              )}
              <Action
                title="Refresh Status"
                icon={Icon.ArrowClockwise}
                onAction={checkStatus}
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
