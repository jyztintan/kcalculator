import cron from "node-cron";
import type { Telegraf } from "telegraf";
import { prisma } from "../lib/prisma.js";

function getHourAndMinuteForTimezone(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone
  });

  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return { hour, minute };
}

export function startReminderScheduler(bot: Telegraf | null) {
  if (!bot) {
    return null;
  }

  return cron.schedule("* * * * *", async () => {
    const now = new Date();
    const reminders = await prisma.reminder.findMany({
      where: { enabled: true },
      include: { user: true }
    });

    await Promise.all(
      reminders.map(async (reminder) => {
        const currentTime = getHourAndMinuteForTimezone(now, reminder.timezone);
        if (currentTime.hour !== reminder.hour || currentTime.minute !== reminder.minute) {
          return;
        }

        const alreadySentThisMinute =
          reminder.lastSentAt &&
          Math.abs(now.getTime() - reminder.lastSentAt.getTime()) < 60_000;

        if (alreadySentThisMinute) {
          return;
        }

        const text =
          reminder.type === "weigh_in"
            ? `Reminder: ${reminder.label}.`
            : `Reminder: ${reminder.label}. Log your calories with /log or just send a natural language message.`;

        await bot.telegram.sendMessage(reminder.user.telegramId, text);
        await prisma.reminder.update({
          where: { id: reminder.id },
          data: { lastSentAt: now }
        });
      })
    );
  });
}
