import type { ParseLogResult } from "@kcalculator/shared";
import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import { allowedTelegramIds, env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { getDashboardAnalytics, getTodaySummaryText } from "../services/analytics.js";
import { parseLogMessage } from "../services/parser.js";
import { ensureUser } from "../services/users.js";

type SessionState = {
  kind: "parse-confirm";
  payload: ParseLogResult;
};

const sessions = new Map<number, SessionState>();

function isAllowedUser(telegramId: string) {
  return allowedTelegramIds.has(telegramId);
}

async function requireUser(ctx: Context) {
  const from = ctx.from;
  if (!from) {
    return null;
  }

  // can deprecate this if going public
  if (!isAllowedUser(String(from.id))) {
    await ctx.reply("This bot is currently restricted to approved users only.");
    return null;
  }

  return ensureUser({
    telegramId: String(from.id),
    username: from.username,
    firstName: from.first_name
  });
}

async function createMealEntry(userId: string, payload: ParseLogResult & { foodName: string; calories: number }) {
  const food = await prisma.food.findFirst({
    where: {
      userId,
      slug: payload.foodName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    }
  });

  return prisma.mealEntry.create({
    data: {
      userId,
      foodId: food?.id,
      entryDate: new Date(`${payload.entryDate}T00:00:00.000Z`),
      foodName: payload.foodName,
      calories: payload.calories,
      source: "parsed"
    }
  });
}

async function showLogMenu(ctx: Context, userId: string) {
  const favorites = await prisma.food.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 6
  });

  const favoriteButtons = favorites.map((food: { id: string; name: string; defaultCalories: number }) =>
    Markup.button.callback(`${food.name} (${food.defaultCalories})`, `favorite:${food.id}`)
  );

  await ctx.reply(
    "Send `food kcal` like `chicken rice 650`, or tap a favorite.",
    Markup.inlineKeyboard([
      ...favoriteButtons.map((button: ReturnType<typeof Markup.button.callback>) => [button])
    ])
  );
}

export function createTelegramBot() {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return null;
  }

  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

  bot.start(async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    await ctx.reply(
      [
        `Hello ${user.firstName ?? "there"}!`,
        "Use /log to add food, /today for your summary, /week for recent adherence, /goal 2200 to set today's target, and /reminders to view reminders."
      ].join("\n")
    );
  });

  bot.command("log", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const args = ctx.message.text.replace(/^\/log(@\w+)?\s*/, "").trim();
    if (args) {
      const parsed = await parseLogMessage(args);
      if (parsed.foodName && parsed.calories) {
        sessions.set(ctx.chat.id, { kind: "parse-confirm", payload: parsed });
        await ctx.reply(
          `Confirm log: ${parsed.foodName} - ${parsed.calories} kcal`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback("Save", "parse-confirm"),
              Markup.button.callback("Cancel", "parse-reject")
            ]
          ])
        );
        return;
      }
    }

    await showLogMenu(ctx, user.id);
  });

  bot.command("editlast", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const match = ctx.message.text.match(/\/editlast(@\w+)?\s+(\d{2,5})/);
    if (!match) {
      await ctx.reply(
        "Use `/editlast 650` to update the most recent entry calories.",
        {
          parse_mode: "Markdown",
        },
      );
      return;
    }

    const lastEntry = await prisma.mealEntry.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!lastEntry) {
      await ctx.reply("No entries found yet.");
      return;
    }

    await prisma.mealEntry.update({
      where: { id: lastEntry.id },
      data: { calories: Number(match[2]) },
    });

    await ctx.reply(`Updated ${lastEntry.foodName} to ${match[2]} kcal.`);
  });

  bot.command("today", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    await ctx.reply(await getTodaySummaryText(user.id));
  });

  bot.command("week", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const analytics = await getDashboardAnalytics({ userId: user.id, days: 7 });
    await ctx.reply(
      [
        `Tracked days: ${analytics.summary.trackedDays}`,
        `Hit days: ${analytics.summary.hitDays}`,
        `Missed days: ${analytics.summary.missedDays}`,
        `Avg calories: ${analytics.summary.weeklyAverage}`,
        `Adherence: ${(analytics.summary.adherenceRate * 100).toFixed(0)}%`
      ].join("\n")
    );
  });

  bot.command("goal", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const match = ctx.message.text.match(/\/goal(@\w+)?\s+(\d{3,5})/);
    if (!match) {
      await ctx.reply("Use `/goal 2200` to modify your daily calorie target.", {
        parse_mode: "Markdown"
      });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { defaultCalorieTarget: Number(match[2]) }
    });

    await ctx.reply(`Your daily target is now ${match[2]} kcal.`);
  });

  bot.hears(/^\/reminders\s+add\s+(.+)\s+(\d{1,2}):(\d{2})$/i, async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const match = ctx.message.text.match(/^\/reminders\s+add\s+(.+)\s+(\d{1,2}):(\d{2})$/i);
    if (!match) {
      return;
    }

    await prisma.reminder.create({
      data: {
        userId: user.id,
        label: match[1],
        type: "log_meal",
        hour: Number(match[2]),
        minute: Number(match[3]),
        timezone: user.timezone
      }
    });

    await ctx.reply(`Reminder created for ${match[1]} at ${match[2]}:${match[3]}.`);
  });

  bot.command("reminders", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const reminders = await prisma.reminder.findMany({
      where: { userId: user.id },
      orderBy: [{ hour: "asc" }, { minute: "asc" }]
    });

    if (reminders.length === 0) {
      await ctx.reply("No reminders yet. Use `/reminders add lunch 12:30`.", {
        parse_mode: "Markdown"
      });
      return;
    }

    const lines = reminders.map(
      (reminder: { label: string; hour: number; minute: number }) =>
        `- ${reminder.label} at ${String(reminder.hour).padStart(2, "0")}:${String(reminder.minute).padStart(2, "0")}`
    );

    await ctx.reply(lines.join("\n"));

    await ctx.reply(
      "Tap a reminder to delete it:",
      Markup.inlineKeyboard(
        reminders.map(
          (reminder: { id: string; label: string; hour: number; minute: number }) => [
            Markup.button.callback(
              `${reminder.label} ${String(reminder.hour).padStart(2, "0")}:${String(reminder.minute).padStart(2, "0")}`,
              `reminder-delete:${reminder.id}`
            )
          ]
        )
      )
    );
  });

  bot.action(/reminder-delete:(.+)/, async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const reminderId = ctx.match[1];
    const reminder = await prisma.reminder.findFirst({
      where: { id: reminderId, userId: user.id }
    });

    if (!reminder) {
      await ctx.answerCbQuery("Reminder not found");
      return;
    }

    await prisma.reminder.delete({ where: { id: reminder.id } });
    await ctx.answerCbQuery("Deleted");
    await ctx.reply(
      `Deleted reminder: ${reminder.label} at ${String(reminder.hour).padStart(2, "0")}:${String(
        reminder.minute
      ).padStart(2, "0")}`
    );
  });

  bot.action(/favorite:(.+)/, async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const food = await prisma.food.findUnique({ where: { id: ctx.match[1] } });
    if (!food) {
      await ctx.answerCbQuery("Favorite not found");
      return;
    }

    await prisma.mealEntry.create({
      data: {
        userId: user.id,
        foodId: food.id,
        entryDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
        foodName: food.name,
        calories: food.defaultCalories,
        source: "favorite"
      }
    });

    await ctx.answerCbQuery();
    await ctx.reply(`Logged ${food.name} for ${food.defaultCalories} kcal.`);
  });

  bot.action("parse-confirm", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const session = sessions.get(ctx.chat!.id);
    if (!session || session.kind !== "parse-confirm") {
      await ctx.answerCbQuery("Nothing to confirm");
      return;
    }

    if (!session.payload.foodName || !session.payload.calories) {
      await ctx.answerCbQuery("Missing parsed fields");
      return;
    }

    await createMealEntry(user.id, {
      ...session.payload,
      foodName: session.payload.foodName,
      calories: session.payload.calories
    });

    await prisma.parserAudit.create({
      data: {
        userId: user.id,
        rawMessage: "telegram-natural-language",
        parsedPayload: session.payload,
        confidence: session.payload.confidence,
        accepted: true
      }
    });

    sessions.delete(ctx.chat!.id);
    await ctx.answerCbQuery();
    await ctx.reply("Saved parsed entry.");
  });

  bot.action("parse-reject", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const session = sessions.get(ctx.chat!.id);
    if (session?.kind === "parse-confirm") {
      await prisma.parserAudit.create({
        data: {
          userId: user.id,
          rawMessage: "telegram-natural-language",
          parsedPayload: session.payload,
          confidence: session.payload.confidence,
          accepted: false
        }
      });
    }

    sessions.delete(ctx.chat!.id);
    await ctx.answerCbQuery();
    await ctx.reply("Cancelled.");
  });

  bot.on("text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) {
      return;
    }

    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const parsed = await parseLogMessage(ctx.message.text);
    await prisma.parserAudit.create({
      data: {
        userId: user.id,
        rawMessage: ctx.message.text,
        parsedPayload: parsed,
        confidence: parsed.confidence,
        accepted: null
      }
    });

    if (!parsed.foodName || !parsed.calories || parsed.confidence < 0.7) {
      await ctx.reply(
        "I could not confidently parse that. Please include a food name and calories, like `chicken rice 650`.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    sessions.set(ctx.chat.id, { kind: "parse-confirm", payload: parsed });
    await ctx.reply(
      `I parsed: ${parsed.foodName} - ${parsed.calories} kcal. Save it?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("Save", "parse-confirm"),
          Markup.button.callback("Cancel", "parse-reject")
        ]
      ])
    );
  });

  return bot;
}
