import { getPreferenceValues } from "@raycast/api";

export interface Preferences {
  apiKey: string;
  favoriteContacts: string;
  serviceUrl: string;
}

export function getPreferences(): Preferences {
  return getPreferenceValues<Preferences>();
}

export function getFavoriteContacts(): string[] {
  const { favoriteContacts } = getPreferences();
  if (!favoriteContacts) return [];

  return favoriteContacts
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length > 0);
}

export function getServiceUrl(): string {
  const { serviceUrl } = getPreferences();
  // Support full URL (http://host:3847) or just port (3847)
  if (serviceUrl?.includes("://")) {
    return serviceUrl.replace(/\/$/, ""); // Remove trailing slash if present
  }
  const port = serviceUrl || "3847";
  return `http://localhost:${port}`;
}

export function getApiKey(): string {
  const { apiKey } = getPreferences();
  return apiKey;
}
