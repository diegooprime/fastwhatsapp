import {
  List,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  useNavigation,
  getPreferenceValues,
} from "@raycast/api";
import { useState, useEffect, useMemo } from "react";
import { api, Contact, ConnectionStatus } from "./api";
import { getFavoriteNumbers } from "./preferences";
import { ComposeMessage } from "./compose";
import { ConversationView } from "./conversation";
import { QRCodeView } from "./qr";

export default function Command() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const { push } = useNavigation();

  const favoriteNumbers = useMemo(() => getFavoriteNumbers(), []);

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

  // Filter and sort contacts
  const { favorites, others } = useMemo(() => {
    const filtered = searchText
      ? contacts.filter(
          (c) =>
            c.name.toLowerCase().includes(searchText.toLowerCase()) ||
            c.number.includes(searchText)
        )
      : contacts;

    const favs: Contact[] = [];
    const rest: Contact[] = [];

    filtered.forEach((contact) => {
      const isFavorite = favoriteNumbers.some(
        (fav) => contact.number.includes(fav.replace(/\D/g, "")) || fav.includes(contact.number)
      );
      if (isFavorite) {
        favs.push(contact);
      } else {
        rest.push(contact);
      }
    });

    return { favorites: favs, others: rest };
  }, [contacts, searchText, favoriteNumbers]);

  function ContactItem({ contact }: { contact: Contact }) {
    return (
      <List.Item
        key={contact.id}
        title={contact.name}
        subtitle={contact.number}
        icon={Icon.Person}
        accessories={contact.isMyContact ? [{ icon: Icon.Star }] : []}
        actions={
          <ActionPanel>
            <Action
              title="Send Message"
              icon={Icon.Message}
              onAction={() => push(<ComposeMessage contact={contact} />)}
            />
            <Action
              title="View Conversation"
              icon={Icon.Eye}
              onAction={() => push(<ConversationView contact={contact} />)}
            />
            <Action.CopyToClipboard
              title="Copy Number"
              content={contact.number}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
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
