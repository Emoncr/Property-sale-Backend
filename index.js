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
import { verifyWebhook } from "@clerk/express/webhooks";

const app = express();
app.use(express.json());
app.use(cookieParser());

const expressServer = http.createServer(app);

//Handling CORS origin
if (process.env.NODE_ENV === "local") {
  app.use(
    cors({
      origin: "http://localhost:5173",
      credentials: true,
    })
  );
} else {
  app.use(
    cors({
      origin: "*",
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    })
  );
}

const PORT = process.env.PORT || 3000;

// Connect to the database
main().catch((err) => console.log(err));
async function main() {
  await mongoose.connect(process.env.MONGO);
  console.log("Database connected");
}

// Import your existing User model
import User from "./api/models/user.models.js";
import { Webhook } from "svix";

// Starting the server
expressServer.listen(PORT, () => {
  console.log(`Server running at port ${PORT}`);
});

app.use("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running healthy",
  });
});

// Enhanced Webhooks for User Management
app.post(
  "/api/webhooks/clerk",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const payload = req.body.toString("utf8");
    const headers = req.headers;
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    try {
      const wh = new Webhook(secret);
      const event = wh.verify(payload, headers); // Verifies signature & parses event
      console.log("Received Clerk webhook event:", wh);

      if (event.type === "user.created") {
        const user = event.data;
        console.log(
          "✅ New Clerk user:",
          user.id,
          user.email_addresses[0].email_address
        );

        await handleUserCreated(event.data); // ➜ Here you can create user in your database or trigger onboarding
      }

      res.status(200).send("Webhook processed");
    } catch (err) {
      console.error("❌ Webhook verification failed:", err.message);
      res.status(400).send("Invalid signature");
    }
  }
);

// Handle User Creation - Simplified for existing auth system
async function handleUserCreated(userData) {
  try {
    const {
      id: clerkId,
      email_addresses,
      first_name,
      last_name,
      username,
    } = userData;

    // Get primary email
    const primaryEmail = email_addresses.find(
      (email) => email.id === userData.primary_email_address_id
    );

    // Check if user already exists (to avoid duplicates)
    const existingUser = await User.findOne({
      $or: [{ clerkId }, { email: primaryEmail?.email_address }],
    });

    if (existingUser) {
      // Update existing user with Clerk ID if missing
      if (!existingUser.clerkId) {
        existingUser.clerkId = clerkId;
        await existingUser.save();
      }
      console.log(`User already exists: ${existingUser.email}`);
      return;
    }

    // Create new user from Clerk data
    const newUser = new User({
      clerkId,
      email: primaryEmail?.email_address || "",
      firstName: first_name || "",
      lastName: last_name || "",
      username: username || `user_${clerkId.slice(-8)}`,
      // Add any other fields your existing User schema requires
    });

    await newUser.save();
    console.log(`New Clerk user created: ${newUser.email}`);
  } catch (error) {
    console.error("Error creating Clerk user:", error);
    throw error;
  }
}

// Handle User Update
async function handleUserUpdated(userData) {
  try {
    const {
      id: clerkId,
      email_addresses,
      first_name,
      last_name,
      username,
      image_url,
    } = userData;

    const primaryEmail = email_addresses.find(
      (email) => email.id === userData.primary_email_address_id
    );

    const updatedUser = await User.findOneAndUpdate(
      { clerkId },
      {
        email: primaryEmail?.email_address || "",
        firstName: first_name || "",
        lastName: last_name || "",
        username: username || "",
        avatar: image_url || "",
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (updatedUser) {
      console.log(`User updated successfully: ${updatedUser.email}`);
    } else {
      console.log(`User not found for update: ${clerkId}`);
    }
  } catch (error) {
    console.error("Error updating user:", error);
    throw error;
  }
}

// Handle User Deletion
async function handleUserDeleted(userData) {
  try {
    const { id: clerkId } = userData;

    const deletedUser = await User.findOneAndDelete({ clerkId });

    if (deletedUser) {
      console.log(`User deleted successfully: ${deletedUser.email}`);

      // Optional: Clean up user-related data
      // await cleanupUserData(clerkId);
    } else {
      console.log(`User not found for deletion: ${clerkId}`);
    }
  } catch (error) {
    console.error("Error deleting user:", error);
    throw error;
  }
}

// Optional: Welcome notification function
async function sendWelcomeNotification(user) {
  try {
    // Add your notification logic here
    // This could be sending an email, creating a notification record, etc.
    console.log(`Sending welcome notification to ${user.email}`);
  } catch (error) {
    console.error("Error sending welcome notification:", error);
  }
}

// Optional: Cleanup function for user deletion
async function cleanupUserData(clerkId) {
  try {
    // Clean up user-related data like posts, messages, etc.
    // Example:
    // await Post.deleteMany({ userId: clerkId });
    // await Message.deleteMany({ senderId: clerkId });
    console.log(`Cleaning up data for user: ${clerkId}`);
  } catch (error) {
    console.error("Error cleaning up user data:", error);
  }
}

// Routes
app.use("/api/users", userRouter);
app.use("/api/auth", auth);
app.use("/api/posts", postRouter);
app.use("/api/message", messageRouter);
app.use("/api/conversation", conversationRoute);
app.use("/api/notification", notificatonRoute);

//============== Deployment==============//

const __dirname = path.resolve();

if (process.env.NODE_ENV === "production") {
  const staticFilesPath = path.join(__dirname, "client", "dist");
  app.use(express.static(staticFilesPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(staticFilesPath, "index.html"));
  });
} else {
  app.get("/", (req, res) => {
    res.send("api listing...");
  });
}

//============== Deployment==============//

// Handle middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
  });
});

//----------------------------Handling Socket.io ------------------------------//

//Handling CORS origin
export const io = new Server(expressServer, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://property-sell.vercel.app",
      "https://property-sell-gjz462ec1-emoncr.vercel.app/",
      "http://localhost:3000",
      "https://property-sell.onrender.com",
    ],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log(`socket connected with ${socket.id}`);

  //=======Messaging Feature Here ======//
  socket.on("join_room", (chatId) => {
    socket.join(chatId);
  });

  socket.on("send_message", (data) => {
    socket.to(data.chatId).emit("receive_message", data);
    socket.broadcast.emit(`${data.to}`, data);
  });

  socket.on("disconnect", (data) => {
    console.log(`user disconnected successfully ${socket.id}`);
  });
});
