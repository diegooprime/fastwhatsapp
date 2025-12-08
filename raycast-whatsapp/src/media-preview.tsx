import {
  Detail,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
} from "@raycast/api";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { api } from "./api";

interface MediaPreviewProps {
  mediaData: string;
  mediaType: "image" | "sticker";
  contactName: string;
  timestamp: number;
  messageId: string;
}

const REACTION_EMOJIS = ["👍🏻", "❤️", "😂", "🙏🏻", "😩"];

export function MediaPreview({
  mediaData,
  mediaType,
  contactName,
  timestamp,
  messageId,
}: MediaPreviewProps) {
  function formatTime(ts: number): string {
    const date = new Date(ts * 1000);
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDate(ts: number): string {
    const date = new Date(ts * 1000);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    if (isToday) return "Today";
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    
    return date.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  async function copyImageToClipboard() {
    try {
      const match = mediaData.match(/data:([^;]+);base64,(.+)/);
      if (!match) {
        throw new Error("Invalid image data");
      }

      const [, mimeType, base64Data] = match;
      const isPng = mimeType.includes("png");
      const ext = isPng ? "png" : "jpg";
      const tmpFile = path.join(os.tmpdir(), `wa-preview-${Date.now()}.${ext}`);

      // Write the file
      fs.writeFileSync(tmpFile, Buffer.from(base64Data, "base64"));
      
      // Use AppleScript to copy image to clipboard (more reliable)
      if (isPng) {
        execSync(`osascript -e 'set the clipboard to (read (POSIX file "${tmpFile}") as «class PNGf»)'`);
      } else {
        execSync(`osascript -e 'set the clipboard to (read (POSIX file "${tmpFile}") as JPEG picture)'`);
      }

      // Cleanup after delay to ensure clipboard has the data
      setTimeout(() => {
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          // Ignore cleanup errors
        }
      }, 2000);

      showToast({
        style: Toast.Style.Success,
        title: "Image copied to clipboard",
      });
    } catch (error) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to copy image",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async function reactToImage(emoji: string) {
    try {
      await api.reactToMessage(messageId, emoji);
      showToast({
        style: Toast.Style.Success,
        title: `Reacted with ${emoji}`,
      });
    } catch (error) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to react",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Resize large images to fit in view using macOS sips
  function getResizedImageData(): string {
    try {
      const match = mediaData.match(/data:([^;]+);base64,(.+)/);
      if (!match) return mediaData;

      const [, mimeType, base64Data] = match;
      const tmpFile = path.join(os.tmpdir(), `wa-orig-${Date.now()}.${mimeType.split("/")[1] || "png"}`);
      const resizedFile = path.join(os.tmpdir(), `wa-resized-${Date.now()}.${mimeType.split("/")[1] || "png"}`);

      // Write original image
      fs.writeFileSync(tmpFile, Buffer.from(base64Data, "base64"));

      // Resize using sips (macOS built-in) - max 400px (constrains both width and height)
      // This ensures tall vertical images fit in the view
      try {
        execSync(`sips -Z 400 "${tmpFile}" --out "${resizedFile}"`, { stdio: "ignore" });
        
        // Check if resized file exists and is smaller
        if (fs.existsSync(resizedFile) && fs.statSync(resizedFile).size > 0) {
          const resizedBuffer = fs.readFileSync(resizedFile);
          const resizedBase64 = resizedBuffer.toString("base64");
          
          // Cleanup
          try {
            fs.unlinkSync(tmpFile);
            fs.unlinkSync(resizedFile);
          } catch {}
          
          return `data:${mimeType};base64,${resizedBase64}`;
        }
      } catch {
        // sips failed, use original
      }

      // Cleanup and return original if resize failed
      try {
        fs.unlinkSync(tmpFile);
        if (fs.existsSync(resizedFile)) fs.unlinkSync(resizedFile);
      } catch {}
      
      return mediaData;
    } catch {
      return mediaData;
    }
  }

  // Use resized image for display, plain markdown
  const displayImageData = getResizedImageData();
  const markdown = `![${mediaType}](${displayImageData})`;

  return (
    <Detail
      navigationTitle={`${mediaType === "sticker" ? "🎭 Sticker" : "📷 Image"} from ${contactName} • ${formatDate(timestamp)}, ${formatTime(timestamp)}`}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action
            title="Copy Image"
            icon={Icon.Clipboard}
            onAction={copyImageToClipboard}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
          />
          <ActionPanel.Submenu
            title="React"
            icon={Icon.Emoji}
            shortcut={{ modifiers: ["cmd"], key: "e" }}
          >
            {REACTION_EMOJIS.map((emoji) => (
              <Action
                key={emoji}
                title={emoji}
                onAction={() => reactToImage(emoji)}
              />
            ))}
          </ActionPanel.Submenu>
        </ActionPanel>
      }
    />
  );
}
