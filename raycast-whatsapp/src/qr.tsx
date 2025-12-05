import {
  Detail,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
} from "@raycast/api";
import { useState, useEffect, useCallback } from "react";
import { api } from "./api";

interface QRCodeViewProps {
  onAuthenticated: () => void;
}

export function QRCodeView({ onAuthenticated }: QRCodeViewProps) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading QR code...");
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const status = await api.getStatus();
      if (status.ready) {
        showToast({
          style: Toast.Style.Success,
          title: "Connected!",
          message: "WhatsApp is now connected",
        });
        onAuthenticated();
        return true;
      }
    } catch {
      // Ignore errors
    }
    return false;
  }, [onAuthenticated]);

  const loadQR = useCallback(async () => {
    setIsLoading(true);
    try {
      // First check if already authenticated
      if (await checkAuth()) {
        return;
      }

      const response = await api.getQR();
      
      if (response.qr) {
        setQrCode(response.qr);
        setMessage("Scan this QR code with WhatsApp on your phone");
      } else if (response.message) {
        setMessage(response.message);
      }
    } catch (error: any) {
      setMessage("Failed to load QR code. Is the service running?");
      showToast({
        style: Toast.Style.Failure,
        title: "Error",
        message: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  }, [checkAuth]);

  useEffect(() => {
    loadQR();

    // Poll for authentication status
    const interval = setInterval(async () => {
      const authenticated = await checkAuth();
      if (!authenticated && !qrCode) {
        // Refresh QR if not authenticated and no QR shown
        loadQR();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [loadQR, checkAuth, qrCode]);

  const markdown = qrCode
    ? `# Scan QR Code\n\n![QR Code](${qrCode})\n\n${message}`
    : `# WhatsApp Authentication\n\n${message}`;

  return (
    <Detail
      markdown={markdown}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action
            title="Refresh QR Code"
            icon={Icon.ArrowClockwise}
            onAction={loadQR}
          />
          <Action
            title="Check Connection"
            icon={Icon.Checkmark}
            onAction={checkAuth}
          />
        </ActionPanel>
      }
    />
  );
}
