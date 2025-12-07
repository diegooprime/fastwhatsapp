import { getPreferenceValues } from "@raycast/api";

export interface Preferences {
  apiKey: string;
  favoriteContacts: string;
  servicePort: string;
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
  const { servicePort } = getPreferences();
  const port = servicePort || "3847";
  return `http://localhost:${port}`;
}

export function getApiKey(): string {
  const { apiKey } = getPreferences();
  return apiKey;
}
