import type { ParseLogResult } from "@kcalculator/shared";
import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { message } from "telegraf/filters";
import type { Telegraf } from "telegraf";
import OpenAI from "openai";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { dateKeyToUtcMidnight, getLocalDateKey } from "../services/dates.js";
import { parseBacklogMessage, parseLogMessage } from "../services/parser.js";
import { EntrySource } from "@prisma/client";

const openai = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
  : null;


type SessionState =
  | {
      kind: "parse-confirm";
      payload: ParseLogResult;
    }
  | {
      kind: "delete-last-confirm";
      payload: { foodName: string; entryId: string };
    };

type RequireUser = (
  ctx: Context,
) => Promise<{ id: string; timezone: string } | null>;

const sessions = new Map<number, SessionState>();

const LOG_MENU_MESSAGE =
  "Send `/log <food> <kcal>` — for example, `/log chicken rice 650` — or choose a favourite:";
const FAV_MENU_MESSAGE = "Choose a favourite to log, or cancel operation?";

async function createMealEntry(
  userId: string,
  entryDate: string,
  foodName: string,
  calories: number,
  source: EntrySource,
) {
  return prisma.mealEntry.create({
    data: {
      userId,
      entryDate: dateKeyToUtcMidnight(entryDate),
      foodName: foodName,
      calories: calories,
      source: source,
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
        `${food.name} with ${food.defaultCalories} kcal`,
        `log-favourite:${food.id}`,
      ),
    ],
  );

  if (options.addCancel) {
    rows.push([Markup.button.callback("Cancel", "fav-cancel")]);
  }

  return Markup.inlineKeyboard(rows);
}

async function handleParsedInput(
  ctx: Context,
  id: string,
  timezone: string,
  parsed: ParseLogResult,
): Promise<void> {
  if (!parsed.foodName) {
    await ctx.reply(LOG_MENU_MESSAGE, {
      parse_mode: "Markdown",
      ...(await getFavouritesKeyboard(id)),
    });
    return;
  }

  // 1. use explicit food name and calories if given
  if (parsed.foodName && parsed.calories) {
    sessions.set(ctx.chat!.id, { kind: "parse-confirm", payload: parsed });
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
  }

  // 2. use favourite if name matches and no calories given
  const favourite = await prisma.food.findFirst({
    where: { userId: id, name: parsed.foodName },
  });
  if (favourite) {
    sessions.set(ctx.chat!.id, { kind: "parse-confirm", payload: { entryDate: getLocalDateKey(timezone), foodName: favourite.name, calories: favourite.defaultCalories, confidence: 0.99 } });
    await ctx.reply(
      `Eh found your favourite: ${favourite.name} with ${favourite.defaultCalories} kcal`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("Save", "parse-confirm"),
          Markup.button.callback("Cancel", "parse-reject"),
        ],
      ]),
    );
    return;
  }

  await ctx.reply(
    `Don't play play leh, I couldn't find ${parsed.foodName} in your favourites. Use /addfav to add it first.`,
    {
      parse_mode: "Markdown",
      ...(await getFavouritesKeyboard(id)),
    },
  );
  return;
}

async function handleLogInput(
  ctx: Context,
  id: string,
  timezone: string,
  text: string,
): Promise<void> {
  const parsed = await parseLogMessage(text, timezone);
  await handleParsedInput(ctx, id, timezone, parsed);
}

async function handleBacklogInput(
  ctx: Context,
  id: string,
  timezone: string,
  text: string,
): Promise<void> {
  const parsed = await parseBacklogMessage(text, timezone);
  if (!parsed) {
    await ctx.reply(
      "Use `/backlog YYYY-MM-DD <food> <kcal>` to log a past meal.",
      { parse_mode: "Markdown" },
    );
    return;
  }
  await handleParsedInput(ctx, id, timezone, parsed);
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
    await handleLogInput(ctx, user.id, user.timezone, args);
  });

  bot.command("backlog", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const args = ctx.message.text.replace(/^\/backlog(@\w+)?\s*/, "").trim();
    if (!args) {
      await ctx.reply(
        "Use `/backlog YYYY-MM-DD <food> <kcal>` to log a past meal.",
        { parse_mode: "Markdown" },
      );
      return;
    }

    await handleBacklogInput(ctx, user.id, user.timezone, args);
  });

  bot.on(message("text"), async (ctx, next) => {
    if (ctx.message.text.startsWith("/")) {
      return next();
    }

    const user = await requireUser(ctx);
    if (!user) return;

    if (!openai) {
      await ctx.reply(
        "I currently don't have the yapping capabilities, try again later...",
      );
      return;
    }
    var data: {
      food_name: string;
      calories: number;
      protein: number;
      carbohydrates: number;
      fat: number;
      reasoning: string;
    };
    try {
      const completion = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are Fatty Fatty Bom Bom — a calorie estimating assistant focused on Singapore hawker food, Chinese dishes, and Southeast Asian meals.

            Personality:
            Loud, cheeky Singapore ah beng gym coach who roasts people for overeating. Your tone is funny, blunt, and Singlish-heavy.

            Task:
            Estimate calories and macros from food photos or descriptions.

            Return ONLY valid JSON.

            Schema:
            {
              "food_name": string,
              "calories": number,
              "protein": number,
              "carbohydrates": number,
              "fat": number,
              "reasoning": string
            }

            Rules:
            - food_name: short food name only
            - calories, protein, carbohydrates, fat: numbers
            - reasoning: 4-6 sentences that combine:
              • calorie explanation (ingredients, oil, portion)
              • a funny Singlish roast
            - explanation should naturally transition into the roast
            - roasting intensity depends on portion size (small → light approval, large → aggressive roast)
            - use emojis to enhance the humour
            - output must be valid JSON only, nothing else

            Tone:
            Singlish ah beng humour using words like lah, leh, sia, bro, walao, knn, cb.

            Roasts should exaggerate body imagery such as:
            - stomach becoming HDB flat
            - needing belt extension
            - eating like buffet challenge
            - body expanding

            Humour should feel like a gym bro clowning his friend: playful, exaggerated, never hateful.

            Example tone:
            "Wah this chicken rice about 700 kcal lah — rice cooked with chicken fat plus roasted chicken confirm add up. But bro you say half chicken only, your appetite look like preparing for buffet challenge sia, later stomach expand until become HDB 5-room flat 😂"`,
          },
          {
            role: "user",
            content: ctx.message.text,
          },
        ],
        temperature: 0.8,
      });
      data = JSON.parse(completion.choices[0]?.message?.content?.trim() ?? "");
      if (
        !data.food_name ||
        !data.calories ||
        !data.protein ||
        !data.carbohydrates ||
        !data.fat
      ) {
        await ctx.reply(
          "Oi! You so fat already still want to anyhow? Give me a valid food description cb.",
        );
        return;
      }

      await ctx.reply(
        `${data.calories} kcal, ${data.protein}g protein, ${data.carbohydrates}g carbohydrates, ${data.fat}g fat.\n\n${data.reasoning}`,
      );
    } catch (err) {
      console.error("[bot] OpenAI error:", err);
      await ctx.reply(
        "Something went wrong talking to the assistant. Try again later.",
      );
      return;
    }
    const outgoingLogMessage = `${data.food_name} ${data.calories}`;
    handleLogInput(ctx, user.id, user.timezone, outgoingLogMessage);
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

    const match = args.match(/^(.+)\s+(-?\d{2,5})$/);
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

    const caloriesMatch = ctx.message.text.match(/(-?\d{2,5})\s*(kcal|cal)?\b/);

    const lastEntry = await prisma.mealEntry.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!lastEntry) {
      await ctx.reply("No entries found yet.");
      return;
    }

    if (!caloriesMatch) {
      await ctx.reply(
        `The last entry was ${lastEntry.foodName} with ${lastEntry.calories} kcal.`,
        {
          parse_mode: "Markdown",
        },
      );
      return;
    }

    const calories = Number(caloriesMatch[1]);
    await prisma.mealEntry.update({
      where: { id: lastEntry.id },
      data: { calories },
    });

    await ctx.reply(`Updated ${lastEntry.foodName} to ${calories} kcal.`);
  });

  bot.command("deletelast", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const lastEntry = await prisma.mealEntry.findFirst({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24) } },
      orderBy: { createdAt: "desc" },
    });

    if (!lastEntry) {
      await ctx.reply("No entries found yet.");
      return;
    }

    sessions.set(ctx.chat!.id, {
      kind: "delete-last-confirm",
      payload: { foodName: lastEntry.foodName, entryId: lastEntry.id },
    });
    await ctx.reply(`You sure you want to delete ${lastEntry.foodName} with ${lastEntry.calories} kcal anot?`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Yes", "delete-last-confirm")],
        [Markup.button.callback("No", "delete-last-reject")],
      ]),
    });
  });

  bot.action("delete-last-confirm", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;
    const session = sessions.get(ctx.chat!.id);
    if (!session || session.kind !== "delete-last-confirm" || !session.payload.entryId) {
      await ctx.answerCbQuery("Nothing to confirm");
      return;
    }

    await prisma.mealEntry.delete({
      where: { id: session.payload.entryId },
    });
    sessions.delete(ctx.chat!.id);
    await ctx.answerCbQuery();
    await ctx.reply(`Deleted ${session.payload.foodName}.`);
  });

  bot.action("delete-last-reject", async (ctx) => {
    sessions.delete(ctx.chat!.id);
    await ctx.answerCbQuery();
    await ctx.reply("Cancelled. Don't anyhow ah...");
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

    await createMealEntry(
      user.id,
      todayKey,
      food.name,
      food.defaultCalories,
      "favourite",
    );

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

    await createMealEntry(
      user.id,
      session.payload.entryDate,
      session.payload.foodName,
      session.payload.calories,
      "parsed",
    );

    // await prisma.parserAudit.create({
    //   data: {
    //     userId: user.id,
    //     rawMessage: "telegram-natural-language",
    //     parsedPayload: session.payload,
    //     confidence: session.payload.confidence,
    //     accepted: true,
    //   },
    // });

    sessions.delete(ctx.chat!.id);
    await ctx.answerCbQuery();
    await ctx.reply("Saved parsed entry.");
  });

  bot.action("parse-reject", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    // const session = sessions.get(ctx.chat!.id);
    // if (session?.kind === "parse-confirm") {
    //   await prisma.parserAudit.create({
    //     data: {
    //       userId: user.id,
    //       rawMessage: "telegram-natural-language",
    //       parsedPayload: session.payload,
    //       confidence: session.payload.confidence,
    //       accepted: false,
    //     },
    //   });
    // }

    sessions.delete(ctx.chat!.id);
    await ctx.answerCbQuery();
    await ctx.reply("Cancelled. Walao don't anyhow leh...");
  });

  bot.action("fav-cancel", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("Cancelled. Don't anyhow ah...");
  });
}
