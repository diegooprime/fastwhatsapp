import { getPreferenceValues } from "@raycast/api";

export interface Preferences {
  favoriteNumbers: string;
  servicePort: string;
}

export function getPreferences(): Preferences {
  return getPreferenceValues<Preferences>();
}

export function getFavoriteNumbers(): string[] {
  const { favoriteNumbers } = getPreferences();
  if (!favoriteNumbers) return [];
  
  return favoriteNumbers
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
}

export function getServiceUrl(): string {
  const { servicePort } = getPreferences();
  const port = servicePort || "3847";
  return `http://localhost:${port}`;
}
