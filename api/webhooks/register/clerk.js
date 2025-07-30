import express from "express";
import { Webhook } from "svix";
import bodyParser from "body-parser";

export const clerkWebhook = async (req, res) => {
  bodyParser.raw({ type: "application/json" }), // raw body required for Svix
    (req, res) => {
      const payload = req.body.toString("utf8");
      const headers = req.headers;
      const secret = process.env.CLERK_WEBHOOK_SECRET;

      try {
        const wh = new Webhook(secret);
        const event = wh.verify(payload, headers); // Verifies signature & parses event
        console.log("this is clerk webhook", event);

        if (event.type === "user.created") {
          const user = event.data;
          console.log(
            "✅ New Clerk user:",
            user.id,
            user.email_addresses[0].email_address
          );

          // ➜ Here you can create user in your database or trigger onboarding
        }

        res.status(200).send("Webhook processed");
      } catch (err) {
        console.error("❌ Webhook verification failed:", err.message);
        res.status(400).send("Invalid signature");
      }
    };
};
