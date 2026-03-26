import type { Context } from "telegraf";
import type { Telegraf } from "telegraf";
import { prisma } from "../lib/prisma.js";
import {
  getDashboardAnalytics,
  getDaySummaryText,
  getMonthSummaryText,
  getWeekSummaryText,
} from "../services/analytics.js";

type RequireUser = (ctx: Context) => Promise<{ id: string } | null>;

export function registerStatsCommands(
  bot: Telegraf<Context>,
  requireUser: RequireUser,
) {
  bot.command("day", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const arg =
      ctx.message.text.replace(/^\/day(@\w+)?\s*/, "").trim() || undefined;
    await ctx.reply(await getDaySummaryText(user.id, arg));
  });

  bot.command("yesterday", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;
    await ctx.reply(await getDaySummaryText(user.id, "yesterday"));
  });

  bot.command("week", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    await ctx.reply(await getWeekSummaryText(user.id));
  });

  bot.command("month", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    await ctx.reply(await getMonthSummaryText(user.id));
  });

  bot.command("stats", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;
    const daysArg =
      ctx.message.text.replace(/^\/stats(@\w+)?\s*(\d+)?/, "$2").trim() || "30";

    const days = daysArg ? Number(daysArg) : 30;
    if (days > 250) {
      await ctx.reply("cb you think RAM free isit, max 250 days");
      return;
    }
    await ctx.reply(`Generating stats...`);
    const analytics = await getDashboardAnalytics({ userId: user.id, days });

    const labels = analytics.trend.map((point) => point.date.slice(5));
    const caloriesData = analytics.trend.map((point) => point.calories);
    const targetData = analytics.trend.map((point) => point.target);
    const barBackgroundColors = analytics.trend.map(
      (point) =>
        point.calories > point.target
          ? "rgba(255, 99, 132, 0.6)" // red when exceeded
          : "rgba(54, 162, 235, 0.6)", // blue when did not exceed
    );
    const barBorderColors = analytics.trend.map((point) =>
      point.calories > point.target
        ? "rgba(255, 99, 132, 1)"
        : "rgba(54, 162, 235, 1)",
    );

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
            backgroundColor: barBackgroundColors,
            borderColor: barBorderColors,
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
          xAxes: [
            {
              ticks: {
                maxRotation: 90,
                minRotation: 45,
              },
            },
          ],
          yAxes: [
            {
              ticks: {
                beginAtZero: true,
                min: 0,
              },
            },
          ],
        },
      },
    };

    const width = 1280;
    const height = 640;
    const chartUrl = `https://quickchart.io/chart?w=${width}&h=${height}&devicePixelRatio=1&c=${encodeURIComponent(
      JSON.stringify(chartConfig),
    )}`;

    await ctx.replyWithPhoto(
      { url: chartUrl },
      {
        caption: `Here is your chart for the last ${days} days.`,
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
