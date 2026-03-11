import type { MealType, ParseLogResult } from "@kcalculator/shared";
import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import { allowedTelegramIds, env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { getDashboardAnalytics, getTodaySummaryText } from "../services/analytics.js";
import { parseLogMessage } from "../services/parser.js";
import { ensureUser, getUserByTelegramId } from "../services/users.js";

type SessionState =
  | {
      kind: "structured";
      mealType: MealType;
    }
  | {
      kind: "parse-confirm";
      payload: ParseLogResult;
    };

const sessions = new Map<number, SessionState>();

function isAllowedUser(telegramId: string) {
  return allowedTelegramIds.size === 0 || allowedTelegramIds.has(telegramId);
}

function dateKey() {
  return new Date().toISOString().slice(0, 10);
}

async function requireUser(ctx: Context) {
  const from = ctx.from;
  if (!from) {
    return null;
  }

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

async function createMealEntry(userId: string, payload: ParseLogResult & { mealType: MealType; foodName: string; calories: number }) {
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
      mealType: payload.mealType,
      foodName: payload.foodName,
      calories: payload.calories,
      quantity: payload.quantity,
      notes: payload.notes,
      source: "parsed"
    }
  });
}

async function showLogMenu(ctx: Context, userId: string) {
  const favorites = await prisma.food.findMany({
    where: { userId, isFavorite: true },
    orderBy: { updatedAt: "desc" },
    take: 6
  });

  const mealButtons = (["breakfast", "lunch", "dinner", "snack"] as MealType[]).map((mealType) =>
    Markup.button.callback(mealType, `log-meal:${mealType}`)
  );

  const favoriteButtons = favorites.map((food) =>
    Markup.button.callback(`${food.name} (${food.defaultCalories})`, `favorite:${food.id}`)
  );

  await ctx.reply(
    "Choose a meal type, then send `food kcal` like `chicken rice 650`, or tap a favorite.",
    Markup.inlineKeyboard([
      mealButtons,
      ...favoriteButtons.map((button) => [button])
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
      if (parsed.foodName && parsed.calories && parsed.mealType) {
        sessions.set(ctx.chat.id, { kind: "parse-confirm", payload: parsed });
        await ctx.reply(
          `Confirm log: ${parsed.mealType} - ${parsed.foodName} - ${parsed.calories} kcal`,
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
      await ctx.reply("Use `/goal 2200` to set today's calorie target.", {
        parse_mode: "Markdown"
      });
      return;
    }

    await prisma.dailyTarget.upsert({
      where: {
        userId_targetDate: {
          userId: user.id,
          targetDate: new Date(`${dateKey()}T00:00:00.000Z`)
        }
      },
      update: {
        targetCalories: Number(match[2])
      },
      create: {
        userId: user.id,
        targetDate: new Date(`${dateKey()}T00:00:00.000Z`),
        targetCalories: Number(match[2])
      }
    });

    await ctx.reply(`Today's target is now ${match[2]} kcal.`);
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

    await ctx.reply(
      reminders
        .map((reminder) => `- ${reminder.label} at ${String(reminder.hour).padStart(2, "0")}:${String(reminder.minute).padStart(2, "0")}`)
        .join("\n")
    );
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

  bot.command("editlast", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const match = ctx.message.text.match(/\/editlast(@\w+)?\s+(\d{2,5})/);
    if (!match) {
      await ctx.reply("Use `/editlast 650` to update the most recent entry calories.", {
        parse_mode: "Markdown"
      });
      return;
    }

    const lastEntry = await prisma.mealEntry.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" }
    });

    if (!lastEntry) {
      await ctx.reply("No entries found yet.");
      return;
    }

    await prisma.mealEntry.update({
      where: { id: lastEntry.id },
      data: { calories: Number(match[2]) }
    });

    await ctx.reply(`Updated ${lastEntry.foodName} to ${match[2]} kcal.`);
  });

  bot.action(/log-meal:(.+)/, async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const mealType = ctx.match[1] as MealType;
    sessions.set(ctx.chat!.id, { kind: "structured", mealType });
    await ctx.answerCbQuery();
    await ctx.reply(`Meal type set to ${mealType}. Send \`food kcal\` now, for example \`protein oats 420\`.`, {
      parse_mode: "Markdown"
    });
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
        entryDate: new Date(`${dateKey()}T00:00:00.000Z`),
        mealType: food.defaultMealType ?? "snack",
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

    if (!session.payload.foodName || !session.payload.calories || !session.payload.mealType) {
      await ctx.answerCbQuery("Missing parsed fields");
      return;
    }

    await createMealEntry(user.id, {
      ...session.payload,
      foodName: session.payload.foodName,
      calories: session.payload.calories,
      mealType: session.payload.mealType
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
    await ctx.reply("Cancelled. Use /log for the structured flow.");
  });

  bot.on("text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) {
      return;
    }

    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    const session = sessions.get(ctx.chat.id);
    if (session?.kind === "structured") {
      const match = ctx.message.text.trim().match(/(.+)\s+(\d{2,5})$/);
      if (!match) {
        await ctx.reply("Please send the entry as `food kcal`, for example `chicken rice 650`.", {
          parse_mode: "Markdown"
        });
        return;
      }

      await prisma.mealEntry.create({
        data: {
          userId: user.id,
          entryDate: new Date(`${dateKey()}T00:00:00.000Z`),
          mealType: session.mealType,
          foodName: match[1].trim(),
          calories: Number(match[2]),
          source: "manual"
        }
      });

      sessions.delete(ctx.chat.id);
      await ctx.reply(`Logged ${match[1].trim()} for ${match[2]} kcal.`);
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

    if (!parsed.foodName || !parsed.calories || !parsed.mealType || parsed.confidence < 0.7) {
      await ctx.reply(
        "I could not confidently parse that. Use /log for the structured flow, or include a meal and calories, like `lunch chicken rice 650`.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    sessions.set(ctx.chat.id, { kind: "parse-confirm", payload: parsed });
    await ctx.reply(
      `I parsed: ${parsed.mealType} - ${parsed.foodName} - ${parsed.calories} kcal. Save it?`,
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
