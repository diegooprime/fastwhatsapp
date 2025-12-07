/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** API Key - API key for authenticating with the WhatsApp service. Find it in ~/.whatsapp-raycast/api-key */
  "apiKey": string,
  /** Favorite Contacts - Comma-separated contact names (case-insensitive partial match) */
  "favoriteContacts": string,
  /** Service Port - Port for the local WhatsApp service */
  "servicePort": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `index` command */
  export type Index = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `index` command */
  export type Index = {}
}

