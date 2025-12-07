import express from "express";
import cors from "cors";
import routes from "./routes";
import { whatsappClient } from "./whatsapp";

const PORT = process.env.PORT || 3847;
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" })); // Large limit for base64 images

// Routes
app.use("/", routes);

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Start server and initialize WhatsApp
async function start() {
  try {
    // Start Express server
    app.listen(PORT, () => {
      console.log(`[Server] WhatsApp service running on http://localhost:${PORT}`);
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
