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
process.on("SIGINT", () => {
  console.log("[Server] Shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[Server] Shutting down...");
  process.exit(0);
});
