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
  /** Service URL - Full URL (http://host:3847) or just port (3847) for localhost */
  "serviceUrl": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `index` command */
  export type Index = ExtensionPreferences & {}
  /** Preferences accessible in the `inbox` command */
  export type Inbox = ExtensionPreferences & {}
  /** Preferences accessible in the `search` command */
  export type Search = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `index` command */
  export type Index = {}
  /** Arguments passed to the `inbox` command */
  export type Inbox = {}
  /** Arguments passed to the `search` command */
  export type Search = {}
}

