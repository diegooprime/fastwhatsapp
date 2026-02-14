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
  return "http://nuc:3847";
}

export function getApiKey(): string {
  const { apiKey } = getPreferences();
  return apiKey;
}
