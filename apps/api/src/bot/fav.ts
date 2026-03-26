import type { Context } from "telegraf";
import { Markup } from "telegraf";
import type { Telegraf } from "telegraf";
import { prisma } from "../lib/prisma.js";
import { getLocalDateKey } from "../services/dates.js";
import { createMealEntry } from "./log.js";

type RequireUser = (
  ctx: Context,
) => Promise<{ id: string; timezone: string } | null>;

const FAV_MENU_MESSAGE = "Choose a favourite to log, or cancel operation?";

export async function getFavouritesKeyboard(
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
        `${food.name} [${food.defaultCalories} kCal]`,
        `log-favourite:${food.id}`,
      ),
    ],
  );

  if (options.addCancel) {
    rows.push([Markup.button.callback("Cancel", "fav-cancel")]);
  }

  return Markup.inlineKeyboard(rows);
}

export function registerFavCommands(
  bot: Telegraf<Context>,
  requireUser: RequireUser,
) {
  bot.command("fav", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const foodName = ctx.message.text.replace(/^\/fav(@\w+)?\s*/, "").trim();
    if (!foodName) {
      await ctx.reply(FAV_MENU_MESSAGE, {
        ...(await getFavouritesKeyboard(user.id, { addCancel: true })),
      });
      return;
    }

    const foundFavourite = await prisma.food.findMany({
      where: { userId: user.id, name: { contains: foodName.toLowerCase() } },
    });

    if (foundFavourite.length === 0) {
      await ctx.reply(`No favourites found for ${foodName}. Use /addfav to add one.`);
      return;
    }
    await ctx.reply(
      `Eh found your favourite food with ${foodName}`,
      Markup.inlineKeyboard(foundFavourite.map(
        (food: { id: string; name: string; defaultCalories: number }) =>
          [
            Markup.button.callback(
              `${food.name} [${food.defaultCalories} kCal]`,
              `log-favourite:${food.id}`,
            ),
          ],
        ),
      ),
    );
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

  bot.action("fav-cancel", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("Cancelled. Don't anyhow ah...");
  });
}
