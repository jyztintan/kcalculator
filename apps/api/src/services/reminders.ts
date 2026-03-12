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

    if (reminders.length > 0) {
      const first = reminders[0];
      const tzTime = getHourAndMinuteForTimezone(now, first.timezone);
    }

    await Promise.all(
      reminders.map(async (reminder) => {
        const currentTime = getHourAndMinuteForTimezone(now, reminder.timezone);
        const hourMatch = currentTime.hour === reminder.hour;
        const minuteMatch = currentTime.minute === reminder.minute;
        if (!hourMatch || !minuteMatch) {
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

        try {
          await bot.telegram.sendMessage(reminder.user.telegramId, text);
          await prisma.reminder.update({
            where: { id: reminder.id },
            data: { lastSentAt: now }
          });
          console.log(`[reminders] sent to ${reminder.user.telegramId}: ${reminder.label} ${reminder.hour}:${String(reminder.minute).padStart(2, "0")}`);
        } catch (err) {
          console.error(`[reminders] send failed for reminder ${reminder.id}:`, err);
        }
      })
    );
  });
}
