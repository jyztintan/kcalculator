import type { Context } from "telegraf";
import type { Telegraf } from "telegraf";
import { prisma } from "../lib/prisma.js";
import { getDashboardAnalytics, getTodaySummaryText } from "../services/analytics.js";

type RequireUser = (ctx: Context) => Promise<{ id: string } | null>;

export function registerStatsCommands(bot: Telegraf<Context>, requireUser: RequireUser) {
  bot.command("today", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    await ctx.reply(await getTodaySummaryText(user.id));
  });

  bot.command("week", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const analytics = await getDashboardAnalytics({ userId: user.id, days: 7 });
    await ctx.reply(
      [
        `Tracked days: ${analytics.summary.trackedDays}`,
        `Hit days: ${analytics.summary.hitDays}`,
        `Missed days: ${analytics.summary.missedDays}`,
        `Avg calories: ${analytics.summary.weeklyAverage}`,
        `Adherence: ${(analytics.summary.adherenceRate * 100).toFixed(0)}%`,
      ].join("\n"),
    );
  });

  bot.command("goal", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const match = ctx.message.text.match(/\/goal(@\w+)?\s+(\d{3,5})/);
    if (!match) {
      await ctx.reply("Use `/goal 2200` to modify your daily calorie target.", {
        parse_mode: "Markdown",
      });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { defaultCalorieTarget: Number(match[2]) },
    });

    await ctx.reply(`Your daily target is now ${match[2]} kcal.`);
  });
}

