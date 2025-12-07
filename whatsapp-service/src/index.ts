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

// Graceful shutdown with proper client cleanup
async function gracefulShutdown(signal: string) {
  console.log(`[Server] Received ${signal}, shutting down gracefully...`);
  
  // Set a timeout to force exit if cleanup takes too long
  const forceExitTimeout = setTimeout(() => {
    console.log("[Server] Forced exit after timeout");
    process.exit(1);
  }, 10000); // 10 second timeout

  try {
    await whatsappClient.destroy();
    clearTimeout(forceExitTimeout);
    console.log("[Server] Cleanup complete, exiting");
    process.exit(0);
  } catch (error) {
    console.error("[Server] Error during shutdown:", error);
    clearTimeout(forceExitTimeout);
    process.exit(1);
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
