import type { Context } from "telegraf";
import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import {
  getDashboardAnalytics,
  getDaySummaryText,
} from "../services/analytics.js";
import { issueDashboardToken } from "../services/dashboard-token.js";

type RequireUser = (ctx: Context) => Promise<{ id: string } | null>;

export function registerStatsCommands(
  bot: Telegraf<Context>,
  requireUser: RequireUser,
) {
  bot.command("day", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const arg = ctx.message.text.replace(/^\/day(@\w+)?\s*/, "").trim() || undefined;
    await ctx.reply(await getDaySummaryText(user.id, arg));
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

  bot.command("stats", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const days = 30;
    const analytics = await getDashboardAnalytics({ userId: user.id, days });

    const labels = analytics.trend.map((point) => point.date.slice(5)); // MM-DD for brevity
    const caloriesData = analytics.trend.map((point) => point.calories);
    const targetData = analytics.trend.map((point) => point.target);

    const chartConfig = {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            type: "line",
            label: "Target",
            data: targetData,
            borderColor: "rgba(0, 0, 0, 0.8)",
            borderWidth: 2,
            fill: false,
            pointRadius: 0,
          },
          {
            type: "bar",
            label: "Calories",
            data: caloriesData,
            backgroundColor: "rgba(255, 99, 132, 0.6)",
            borderColor: "rgba(255, 99, 132, 1)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        plugins: {
          legend: {
            position: "top",
          },
          title: {
            display: true,
            text: `Last ${days} days calories`,
          },
        },
        scales: {
          x: {
            ticks: {
              maxRotation: 90,
              minRotation: 45,
            },
          },
          y: {
            beginAtZero: true,
          },
        },
      },
    };

    const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(
      JSON.stringify(chartConfig),
    )}`;

    await ctx.replyWithPhoto(
      { url: chartUrl },
      {
        caption: `Here is your last ${days} days boi. `,
      },
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
