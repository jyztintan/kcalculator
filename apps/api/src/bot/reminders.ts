import type { Context } from "telegraf";
import { Markup } from "telegraf";
import type { Telegraf } from "telegraf";
import { prisma } from "../lib/prisma.js";

type RequireUser = (ctx: Context) => Promise<{ id: string; timezone: string } | null>;

export function registerReminderCommands(
  bot: Telegraf<Context>,
  requireUser: RequireUser,
) {
  bot.hears(
    /^\/reminders\s+add\s+(.+)\s+(\d{1,2}):(\d{2})$/i,
    async (ctx) => {
      const user = await requireUser(ctx);
      if (!user) return;

      const match = ctx.message.text.match(
        /^\/reminders\s+add\s+(.+)\s+(\d{1,2}):(\d{2})$/i,
      );
      if (!match) return;

      await prisma.reminder.create({
        data: {
          userId: user.id,
          label: match[1],
          type: "log_meal",
          hour: Number(match[2]),
          minute: Number(match[3]),
          timezone: user.timezone,
        },
      });

      await ctx.reply(`Reminder created for ${match[1]} at ${match[2]}:${match[3]}.`);
    },
  );

  bot.command("reminders", async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const reminders = await prisma.reminder.findMany({
      where: { userId: user.id },
      orderBy: [{ hour: "asc" }, { minute: "asc" }],
    });

    if (reminders.length === 0) {
      await ctx.reply("No reminders yet. Use `/reminders add lunch 12:30`.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const lines = reminders.map(
      (reminder: { label: string; hour: number; minute: number }) =>
        `- ${reminder.label} at ${String(reminder.hour).padStart(2, "0")}:${String(reminder.minute).padStart(2, "0")}`,
    );
    await ctx.reply(lines.join("\n"));

    await ctx.reply(
      "Tap a reminder to delete it:",
      Markup.inlineKeyboard(
        reminders.map(
          (reminder: { id: string; label: string; hour: number; minute: number }) => [
            Markup.button.callback(
              `${reminder.label} ${String(reminder.hour).padStart(2, "0")}:${String(reminder.minute).padStart(2, "0")}`,
              `reminder-delete:${reminder.id}`,
            ),
          ],
        ),
      ),
    );
  });

  bot.action(/reminder-delete:(.+)/, async (ctx) => {
    const user = await requireUser(ctx);
    if (!user) return;

    const reminderId = ctx.match[1];
    const reminder = await prisma.reminder.findFirst({
      where: { id: reminderId, userId: user.id },
    });

    if (!reminder) {
      await ctx.answerCbQuery("Reminder not found");
      return;
    }

    await prisma.reminder.delete({ where: { id: reminder.id } });
    await ctx.answerCbQuery("Deleted");
    await ctx.reply(
      `Deleted reminder: ${reminder.label} at ${String(reminder.hour).padStart(2, "0")}:${String(
        reminder.minute,
      ).padStart(2, "0")}`,
    );
  });
}

