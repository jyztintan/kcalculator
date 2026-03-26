import { Telegraf } from "telegraf";
import type { Context } from "telegraf";
import { allowedTelegramIds, env } from "../config/env.js";
import { ensureUser } from "../services/users.js";
import { registerLogCommands } from "./log.js";
import { registerStatsCommands } from "./stats.js";
import { registerReminderCommands } from "./reminders.js";
import { message } from "telegraf/filters";
import { registerFavCommands } from "./fav.js";

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
    firstName: from.first_name,
  });
}

function getHelpMessage(user: string) {
  return [
    `Hello ${user} bui bui 🐷! Here's how you can use this bot to stop being a fatty bom bom: \n
    /log to log a food entry for today, \n
    /fav to choose from favourites to log, \n
    /day for your daily summary, \n
    /week for your weekly summary, \n
    /goal 2200 to set your daily target, \n
    /reminders to view your reminders, \n
    /reminders add <name> <hour>:<minute> to add a reminder, \n
    /editlast to edit the most recent entry calories, \n
    /help to show this message again.`,
  ].join("\n");
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

    await ctx.reply(getHelpMessage(user.firstName ?? "there"));
  });

  bot.command("help", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    await ctx.reply(getHelpMessage(user.firstName ?? "there"));
  });

  bot.hears("help", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }

    await ctx.reply(getHelpMessage(user.firstName ?? "there"));
  });

  // this order is important because the log commands will catch all natural language messages
  registerReminderCommands(bot, requireUser);
  registerFavCommands(bot, requireUser);
  registerStatsCommands(bot, requireUser);
  registerLogCommands(bot, requireUser);

  bot.on(message("text"), async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) {
      return;
    }
    await ctx.reply("Unknown command. Use /help to see the available commands.");
  });

  return bot;
}
