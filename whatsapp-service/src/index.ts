import express, { Request, Response, NextFunction } from "express";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import routes from "./routes";
import { whatsappClient } from "./whatsapp";

const PORT = process.env.PORT || 3847;
const app = express();

// API Key management
const API_KEY_PATH = path.join(os.homedir(), ".whatsapp-raycast", "api-key");

function getOrCreateApiKey(): string {
  const dir = path.dirname(API_KEY_PATH);
  
  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  
  // Read existing key or generate new one
  if (fs.existsSync(API_KEY_PATH)) {
    return fs.readFileSync(API_KEY_PATH, "utf-8").trim();
  }
  
  // Generate a secure random key
  const apiKey = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(API_KEY_PATH, apiKey, { mode: 0o600 });
  console.log(`[Server] API key generated and saved to ${API_KEY_PATH}`);
  return apiKey;
}

const API_KEY = getOrCreateApiKey();

// API Key validation middleware
function validateApiKey(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for health check
  if (req.path === "/health") {
    next();
    return;
  }
  
  const providedKey = req.headers["x-api-key"];
  
  if (!providedKey || providedKey !== API_KEY) {
    res.status(401).json({ error: "Unauthorized: Invalid or missing API key" });
    return;
  }
  
  next();
}

// Middleware
app.use(express.json({ limit: "50mb" })); // Large limit for base64 images
app.use(validateApiKey);

// Routes
app.use("/", routes);

// Health check (before auth middleware via path check)
app.get("/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Start server and initialize WhatsApp
async function start() {
  try {
    // Start Express server - bind to localhost only for security
    app.listen(PORT as number, "127.0.0.1", () => {
      console.log(`[Server] WhatsApp service running on http://127.0.0.1:${PORT}`);
    });

    // Initialize WhatsApp client
    await whatsappClient.initialize();
  } catch (error) {
    console.error("[Server] Failed to start:", error);
    process.exit(1);
  }
}

start();

// Graceful shutdown
async function shutdown() {
  console.log("[Server] Shutting down...");
  
  const timeout = setTimeout(() => {
    console.log("[Server] Shutdown timeout, forcing exit");
    process.exit(1);
  }, 5000);

  try {
    await whatsappClient.destroy();
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) {
    console.error("[Server] Error during shutdown:", error);
    process.exit(1);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Prevent crashes from unhandled errors
process.on("uncaughtException", (error) => {
  console.error("[Server] Uncaught exception:", error.message);
  // Don't exit - let the WhatsApp client handle reconnection
});

process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled rejection:", reason);
  // Don't exit - let the WhatsApp client handle reconnection
});
