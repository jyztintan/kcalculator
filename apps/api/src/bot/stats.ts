import type { Context } from "telegraf";
import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import {
  getDashboardAnalytics,
  getTodaySummaryText,
} from "../services/analytics.js";
import { issueDashboardToken } from "../services/dashboard-token.js";

type RequireUser = (ctx: Context) => Promise<{ id: string } | null>;

export function registerStatsCommands(
  bot: Telegraf<Context>,
  requireUser: RequireUser,
) {
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

  bot.command("stats", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const analytics = await getDashboardAnalytics({
      userId: user.id,
      days: 100,
    });

    const dashboardUrl = env.DASHBOARD_PUBLIC_URL?.trim();

    if (!dashboardUrl) {
      await ctx.reply(
        [
          "Dashboard link not configured.",
          "Set `DASHBOARD_PUBLIC_URL` in your API env.",
          "",
          `Stats: ${analytics.summary.trackedDays} tracked days, avg ${analytics.summary.weeklyAverage} kcal`,
        ].join("\n"),
      );
      return;
    }

    const telegramId = String(ctx.from?.id ?? "");
    if (!telegramId) {
      await ctx.reply(
        "Could not determine your Telegram ID for dashboard auth.",
      );
      return;
    }

    const token = issueDashboardToken({
      telegramId,
      expiresInSeconds: 60 * 60 * 24 * 7, // 7 days
    });

    const url = new URL(dashboardUrl);
    url.searchParams.set("token", token);

    await ctx.reply("Dashboard:", Markup.inlineKeyboard([
      [Markup.button.url("Open dashboard", url.toString())],
    ]));
  });
}
