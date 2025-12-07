import { getServiceUrl, getApiKey } from "./preferences";

export interface Contact {
  id: string;
  name: string;
  number: string;
  isGroup: boolean;
}

export interface Message {
  id: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  from: string;
  hasMedia: boolean;
  mediaData?: string;
}

export interface Chat {
  id: string;
  name: string;
  unreadCount: number;
  lastMessage?: string;
}

export type ConnectionStatus = "disconnected" | "connecting" | "qr" | "authenticated" | "ready";

export interface StatusResponse {
  status: ConnectionStatus;
  ready: boolean;
}

export interface QRResponse {
  qr: string | null;
  message?: string;
}

class WhatsAppAPI {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getServiceUrl();
  }

  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    // Re-fetch base URL and API key in case preferences changed
    this.baseUrl = getServiceUrl();
    const apiKey = getApiKey();
    
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async getStatus(): Promise<StatusResponse> {
    return this.fetch<StatusResponse>("/status");
  }

  async getQR(): Promise<QRResponse> {
    return this.fetch<QRResponse>("/qr");
  }

  async getContacts(): Promise<Contact[]> {
    const response = await this.fetch<{ contacts: Contact[] }>("/contacts");
    return response.contacts;
  }

  async getChats(): Promise<Chat[]> {
    const response = await this.fetch<{ chats: Chat[] }>("/chats");
    return response.chats;
  }

  async getMessages(chatId: string, limit: number = 10): Promise<Message[]> {
    const response = await this.fetch<{ messages: Message[] }>(
      `/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`
    );
    return response.messages;
  }

  async sendMessage(chatId: string, message: string): Promise<{ success: boolean; messageId?: string }> {
    return this.fetch<{ success: boolean; messageId?: string }>("/send", {
      method: "POST",
      body: JSON.stringify({ chatId, message }),
    });
  }

  async sendImage(
    chatId: string,
    base64: string,
    caption?: string
  ): Promise<{ success: boolean; messageId?: string }> {
    return this.fetch<{ success: boolean; messageId?: string }>("/send-image", {
      method: "POST",
      body: JSON.stringify({ chatId, base64, caption }),
    });
  }

  async resolveNumber(number: string): Promise<string | null> {
    try {
      const response = await this.fetch<{ chatId: string }>("/resolve-number", {
        method: "POST",
        body: JSON.stringify({ number }),
      });
      return response.chatId;
    } catch {
      return null;
    }
  }
}

export const api = new WhatsAppAPI();
