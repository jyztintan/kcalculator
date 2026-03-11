import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";

type EnsureUserInput = {
  telegramId: string;
  username?: string;
  firstName?: string;
};

export async function ensureUser(input: EnsureUserInput) {
  return prisma.user.upsert({
    where: { telegramId: input.telegramId },
    update: {
      username: input.username,
      firstName: input.firstName
    },
    create: {
      telegramId: input.telegramId,
      username: input.username,
      firstName: input.firstName,
      timezone: env.DEFAULT_TIMEZONE,
      defaultCalorieTarget: env.DEFAULT_CALORIE_TARGET
    }
  });
}

export async function getUserByTelegramId(telegramId: string) {
  return prisma.user.findUnique({ where: { telegramId } });
}

export async function resolveDefaultUser() {
  if (env.DEFAULT_DASHBOARD_TELEGRAM_ID) {
    return getUserByTelegramId(env.DEFAULT_DASHBOARD_TELEGRAM_ID);
  }

  return prisma.user.findFirst({
    orderBy: { createdAt: "asc" }
  });
}
