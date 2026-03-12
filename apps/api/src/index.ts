import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { registerRoutes } from "./routes/index.js";
import { createTelegramBot } from "./bot/index.js";
import { startReminderScheduler } from "./services/reminders.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

await registerRoutes(app);

const bot = createTelegramBot();

if (bot) {
  if (env.TELEGRAM_USE_WEBHOOK && env.TELEGRAM_WEBHOOK_URL) {
    app.post("/telegram/webhook", async (request, reply) => {
      await bot.handleUpdate(request.body as never, reply.raw);
      reply.status(200).send({ ok: true });
    });
    await bot.telegram.setWebhook(`${env.TELEGRAM_WEBHOOK_URL}/telegram/webhook`);
    console.log("[startup] Bot webhook set");
  } else {
    console.log("[startup] Starting bot (polling in background)...");
    bot.launch().then(
      () => console.log("[startup] Bot polling connected"),
      (err) => console.error("[startup] Bot launch failed:", err)
    );
  }
  startReminderScheduler(bot);
  console.log("[startup] Reminder scheduler registered");
} else {
  console.warn("[startup] No TELEGRAM_BOT_TOKEN — bot and reminders disabled");
}

app.addHook("onClose", async () => {
  await prisma.$disconnect();
  if (bot) {
    bot.stop("server stopping");
  }
});

await app.listen({
  port: env.PORT,
  host: "0.0.0.0"
});
