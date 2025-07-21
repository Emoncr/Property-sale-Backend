import express from "express";
import mongoose from "mongoose";
import "dotenv/config";
import userRouter from "./api/routes/user.route.js";
import auth from "./api/routes/auth.route.js";
import cors from "cors";
import cookieParser from "cookie-parser";
import postRouter from "./api/routes/post.route.js";
import messageRouter from "./api/routes/message.route.js";
import conversationRoute from "./api/routes/conversation.route.js";
import notificatonRoute from "./api/routes/notification.route.js";

import path from "path";
import http from "http";
import { Server } from "socket.io";

// Create Express app
const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());

// CORS Configuration - Optimized
const corsOptions = {
  origin: process.env.NODE_ENV === "local" 
    ? "http://localhost:5173"
    : [
        "https://property-sell.vercel.app",
        "https://property-sell-gjz462ec1-emoncr.vercel.app",
        "http://localhost:3000",
        "https://property-sell.onrender.com"
      ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"]
};

app.use(cors(corsOptions));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development"
  });
});

// API Routes
app.use("/api/users", userRouter);
app.use("/api/auth", auth);
app.use("/api/posts", postRouter);
app.use("/api/message", messageRouter);
app.use("/api/conversation", conversationRoute);
app.use("/api/notification", notificatonRoute);

// Static file serving for production
const __dirname = path.resolve();

if (process.env.NODE_ENV === "production") {
  const staticFilesPath = path.join(__dirname, "client", "dist");
  app.use(express.static(staticFilesPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(staticFilesPath, "index.html"));
  });
} else {
  app.get("/", (req, res) => {
    res.json({ 
      message: "API Server Running", 
      version: "1.0.0",
      endpoints: [
        "/api/users",
        "/api/auth", 
        "/api/posts",
        "/api/message",
        "/api/conversation",
        "/api/notification"
      ]
    });
  });
}

// Global error handler
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  
  // Log error in non-production environments
  if (process.env.NODE_ENV !== "production") {
    console.error("Error:", err);
  }
  
  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack })
  });
});

// Database connection with retry logic
let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;
  
  try {
    const conn = await mongoose.connect(process.env.MONGO, {
      bufferCommands: false,
    });
    
    isConnected = conn.connections[0].readyState === 1;
    console.log("Database connected successfully");
  } catch (error) {
    console.error("Database connection error:", error);
    throw error;
  }
};

// Create HTTP server
const expressServer = http.createServer(app);

// Socket.IO setup
export const io = new Server(expressServer, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Join room for messaging
  socket.on("join_room", (chatId) => {
    if (chatId) {
      socket.join(chatId);
      console.log(`Socket ${socket.id} joined room ${chatId}`);
    }
  });

  // Handle message sending
  socket.on("send_message", (data) => {
    if (data?.chatId && data?.to) {
      socket.to(data.chatId).emit("receive_message", data);
      socket.broadcast.emit(`${data.to}`, data);
    }
  });

  // Handle disconnection
  socket.on("disconnect", (reason) => {
    console.log(`Socket ${socket.id} disconnected: ${reason}`);
  });

  // Handle connection errors
  socket.on("error", (error) => {
    console.error(`Socket ${socket.id} error:`, error);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  expressServer.close(() => {
    mongoose.connection.close();
    process.exit(0);
  });
});

// For serverless deployments (Vercel, AWS Lambda, etc.)
const handler = async (req, res) => {
  await connectDB();
  return app(req, res);
};

// For traditional server deployment
const startServer = async () => {
  try {
    await connectDB();
    
    const PORT = process.env.PORT || 3000;
    expressServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Export for serverless or start server for traditional deployment
if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
  // Serverless deployment
  // The export is now at the top level below
} else {
  // Traditional server deployment
  startServer();
}

export default handler;