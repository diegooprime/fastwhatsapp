import {
  Detail,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
} from "@raycast/api";
import { useState, useEffect, useRef } from "react";
import { api } from "./api";

interface QRCodeViewProps {
  onAuthenticated: () => void;
}

export function QRCodeView({ onAuthenticated }: QRCodeViewProps) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading QR code...");
  const [isLoading, setIsLoading] = useState(true);

  // Use refs to avoid effect re-runs and track state across renders
  const onAuthenticatedRef = useRef(onAuthenticated);
  const hasLoadedQR = useRef(false);
  const isAuthenticating = useRef(false);

  // Keep ref in sync
  onAuthenticatedRef.current = onAuthenticated;

  useEffect(() => {
    let isMounted = true;

    const checkAuth = async (): Promise<boolean> => {
      try {
        const status = await api.getStatus();
        if (status.ready && isMounted) {
          showToast({
            style: Toast.Style.Success,
            title: "Connected!",
            message: "WhatsApp is now connected",
          });
          onAuthenticatedRef.current();
          return true;
        }
        // Track if we're in the middle of authenticating (status is "authenticated" but not "ready" yet)
        if (status.status === "authenticated") {
          isAuthenticating.current = true;
        }
      } catch {
        // Ignore errors
      }
      return false;
    };

    const loadQR = async () => {
      if (!isMounted) return;

      setIsLoading(true);
      try {
        // First check if already authenticated
        if (await checkAuth()) {
          return;
        }

        const response = await api.getQR();

        if (!isMounted) return;

        if (response.qr) {
          setQrCode(response.qr);
          setMessage("Scan this QR code with WhatsApp on your phone");
          hasLoadedQR.current = true;
        } else if (response.message) {
          setMessage(response.message);
        }
      } catch (error) {
        if (!isMounted) return;
        setMessage("Failed to load QR code. Is the service running?");
        showToast({
          style: Toast.Style.Failure,
          title: "Error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    // Initial load
    loadQR();

    // Poll for authentication status only - don't reload QR during handshake
    const interval = setInterval(async () => {
      if (!isMounted) return;

      const authenticated = await checkAuth();

      // Only try to reload QR if:
      // 1. Not authenticated
      // 2. Never loaded a QR before
      // 3. Not in the middle of authenticating (handshake in progress)
      if (!authenticated && !hasLoadedQR.current && !isAuthenticating.current) {
        loadQR();
      }
    }, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []); // Empty dependency array - runs once on mount

  const handleRefreshQR = async () => {
    // Manual refresh - reset tracking and reload
    hasLoadedQR.current = false;
    isAuthenticating.current = false;
    setIsLoading(true);

    try {
      const response = await api.getQR();
      if (response.qr) {
        setQrCode(response.qr);
        setMessage("Scan this QR code with WhatsApp on your phone");
        hasLoadedQR.current = true;
      } else if (response.message) {
        setMessage(response.message);
      }
    } catch (error) {
      setMessage("Failed to load QR code. Is the service running?");
      showToast({
        style: Toast.Style.Failure,
        title: "Error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckConnection = async () => {
    try {
      const status = await api.getStatus();
      if (status.ready) {
        showToast({
          style: Toast.Style.Success,
          title: "Connected!",
          message: "WhatsApp is now connected",
        });
        onAuthenticatedRef.current();
      } else {
        showToast({
          style: Toast.Style.Animated,
          title: "Status: " + status.status,
          message:
            status.status === "authenticated"
              ? "Loading WhatsApp..."
              : "Not connected yet",
        });
      }
    } catch {
      showToast({
        style: Toast.Style.Failure,
        title: "Error",
        message: "Could not check status",
      });
    }
  };

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
            title="Refresh Qr Code"
            icon={Icon.ArrowClockwise}
            onAction={handleRefreshQR}
          />
          <Action
            title="Check Connection"
            icon={Icon.Checkmark}
            onAction={handleCheckConnection}
          />
        </ActionPanel>
      }
    />
  );
}
