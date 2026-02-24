#!/bin/bash
# Patches whatsapp-web.js for the hasSynced race condition
# See: https://github.com/pedroslopez/whatsapp-web.js/issues/5758
CLIENT_JS="node_modules/whatsapp-web.js/src/Client.js"

if grep -q "window.AuthStore.AppState.on('change:hasSynced', () => { window.onAppStateHasSyncedEvent(); });" "$CLIENT_JS" 2>/dev/null; then
  sed -i '' "s|window.AuthStore.AppState.on('change:state', (_AppState, state) => { window.onAuthAppStateChangedEvent(state); });|const appState = window.AuthStore.AppState;\n            if (appState.hasSynced) {\n                window.onAppStateHasSyncedEvent();\n            }\n            appState.on('change:hasSynced', (_AppState, hasSynced) => {\n                if (hasSynced) {\n                    window.onAppStateHasSyncedEvent();\n                }\n            });\n            appState.on('change:state', (_AppState, state) => { window.onAuthAppStateChangedEvent(state); });|" "$CLIENT_JS"
  sed -i '' "/window.AuthStore.AppState.on('change:hasSynced', () => { window.onAppStateHasSyncedEvent(); });/d" "$CLIENT_JS"
  echo "Patched whatsapp-web.js hasSynced race condition"
else
  echo "whatsapp-web.js already patched or structure changed"
fi
