import type { ParseLogResult } from "@kcalculator/shared";
import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { message } from "telegraf/filters";
import type { Telegraf } from "telegraf";
import { prisma } from "../lib/prisma.js";
import { dateKeyToUtcMidnight, getLocalDateKey } from "../services/dates.js";
import { parseLogMessage } from "../services/parser.js";

type SessionState = {
  kind: "parse-confirm";
  payload: ParseLogResult;
};

type RequireUser = (
  ctx: Context,
) => Promise<{ id: string; timezone: string } | null>;

const sessions = new Map<number, SessionState>();

const LOG_MENU_MESSAGE =
  "Send `/log <food> <kcal>` — for example, `/log chicken rice 650` — or choose a favourite:";
const FAV_MENU_MESSAGE = "Choose a favourite to log, or cancel operation?";

async function createMealEntry(userId: string, payload: ParseLogResult) {
  return prisma.mealEntry.create({
    data: {
      userId,
      entryDate: dateKeyToUtcMidnight(payload.entryDate),
      foodName: payload.foodName,
      calories: payload.calories,
      source: "parsed",
    },
  });
}

async function getFavouritesKeyboard(
  userId: string,
  options: { addCancel?: boolean } = {},
) {
  const favourites = await prisma.food.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 6,
  });

  const rows = favourites.map(
    (food: { id: string; name: string; defaultCalories: number }) => [
      Markup.button.callback(
        `${food.name} (${food.defaultCalories})`,
        `log-favourite:${food.id}`,
      ),
    ],
  );

  if (options.addCancel) {
    rows.push([Markup.button.callback("Cancel", "fav-cancel")]);
  }

  return Markup.inlineKeyboard(rows);
}

export function registerLogCommands(
  bot: Telegraf<Context>,
  requireUser: RequireUser,
) {
  bot.command("log", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const args = ctx.message.text.replace(/^\/log(@\w+)?\s*/, "").trim();
    if (!args) {
      await ctx.reply(LOG_MENU_MESSAGE, {
        parse_mode: "Markdown",
        ...(await getFavouritesKeyboard(user.id)),
      });
      return;
    }

    const parsed = await parseLogMessage(args, user.timezone);
    if (!parsed.foodName) {
      await ctx.reply(LOG_MENU_MESSAGE, {
        parse_mode: "Markdown",
        ...(await getFavouritesKeyboard(user.id)),
      });
      return;
    }

    // 1. use explicit food name and calories if given
    if (parsed.foodName && parsed.calories) {
      sessions.set(ctx.chat.id, { kind: "parse-confirm", payload: parsed });
      await ctx.reply(
        `Confirm log: ${parsed.foodName} - ${parsed.calories} kcal`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback("Save", "parse-confirm"),
            Markup.button.callback("Cancel", "parse-reject"),
          ],
        ]),
      );
      return;
    } else if (parsed.foodName && !parsed.calories) {
      // 2. use favourite if name matches and no calories given
      const favourite = await prisma.food.findFirst({
        where: { userId: user.id, name: parsed.foodName },
      });

      if (favourite) {
        await prisma.mealEntry.create({
          data: {
            userId: user.id,
            foodId: favourite.id,
            entryDate: dateKeyToUtcMidnight(parsed.entryDate),
            foodName: favourite.name,
            calories: favourite.defaultCalories,
            source: "favourite",
          },
        });

        await ctx.reply(
          `Logged ${favourite.name} for ${favourite.defaultCalories} kcal.`,
        );
        return;
      } else {
        await ctx.reply(
          `Don't play play leh, I couldn't find ${parsed.foodName} in your favourites. Use /addfav to add it first.`, {
          parse_mode: "Markdown",
          ...(await getFavouritesKeyboard(user.id)),
        });
        return;
      }
    }
  });

  bot.command("fav", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    await ctx.reply(FAV_MENU_MESSAGE, {
      ...(await getFavouritesKeyboard(user.id, { addCancel: true })),
    });
  });

  bot.command("addfav", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const args = ctx.message.text.replace(/^\/addfav(@\w+)?\s*/, "").trim();
    if (!args) {
      await ctx.reply("Use `/addfav <food> <calories>` to add a favourite.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const match = args.match(/^(.+)\s+(\d{2,5})$/);
    if (!match) {
      await ctx.reply(
        "Invalid format. Use `/addfav <food> <calories>` to add a favourite.",
        {
          parse_mode: "Markdown",
        },
      );
      return;
    }

    await prisma.food.create({
      data: {
        userId: user.id,
        name: match[1].toLowerCase(),
        defaultCalories: Number(match[2]),
      },
    });
    await ctx.reply(`Favourite ${match[1]} created.`);
  });

  bot.command("editlast", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

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

  bot.action(/log-favourite:(.+)/, async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const food = await prisma.food.findUnique({ where: { id: ctx.match[1] } });
    if (!food) {
      await ctx.answerCbQuery("favourite not found");
      return;
    }

    const todayKey = getLocalDateKey(user.timezone);

    await prisma.mealEntry.create({
      data: {
        userId: user.id,
        foodId: food.id,
        entryDate: dateKeyToUtcMidnight(todayKey),
        foodName: food.name,
        calories: food.defaultCalories,
        source: "favourite",
      },
    });

    await ctx.answerCbQuery();
    await ctx.reply(`Logged ${food.name} for ${food.defaultCalories} kcal.`);
  });

  bot.action("parse-confirm", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

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
      calories: session.payload.calories,
    });

    await prisma.parserAudit.create({
      data: {
        userId: user.id,
        rawMessage: "telegram-natural-language",
        parsedPayload: session.payload,
        confidence: session.payload.confidence,
        accepted: true,
      },
    });

    sessions.delete(ctx.chat!.id);
    await ctx.answerCbQuery();
    await ctx.reply("Saved parsed entry.");
  });

  bot.action("parse-reject", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const session = sessions.get(ctx.chat!.id);
    if (session?.kind === "parse-confirm") {
      await prisma.parserAudit.create({
        data: {
          userId: user.id,
          rawMessage: "telegram-natural-language",
          parsedPayload: session.payload,
          confidence: session.payload.confidence,
          accepted: false,
        },
      });
    }

    sessions.delete(ctx.chat!.id);
    await ctx.answerCbQuery();
    await ctx.reply("Cancelled. Walao don't anyhow leh...");
  });

  bot.action("fav-cancel", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("Cancelled. Don't anyhow ah...");
  });

  bot.on(message("text"), async (ctx, next) => {
    if (ctx.message.text.startsWith("/")) {
      return next();
    }

    const user = await requireUser(ctx);
    if (!user) return;

    const parsed = await parseLogMessage(ctx.message.text, user.timezone);
    await prisma.parserAudit.create({
      data: {
        userId: user.id,
        rawMessage: ctx.message.text,
        parsedPayload: parsed,
        confidence: parsed.confidence,
        accepted: null,
      },
    });

    if (!parsed.foodName || !parsed.calories || parsed.confidence < 0.7) {
      await ctx.reply(
        "I could not confidently parse that. Please include a food name and calories, like `chicken rice 650`.",
        { parse_mode: "Markdown" },
      );
      return;
    }

    sessions.set(ctx.chat.id, { kind: "parse-confirm", payload: parsed });
    await ctx.reply(
      `I parsed: ${parsed.foodName} - ${parsed.calories} kcal. Save it?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("Save", "parse-confirm"),
          Markup.button.callback("Cancel", "parse-reject"),
        ],
      ]),
    );
  });
}
