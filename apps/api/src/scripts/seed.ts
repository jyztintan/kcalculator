import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { ensureUser } from "../services/users.js";

async function main() {
  const defaultTelegramId = env.TELEGRAM_ALLOWED_USER_IDS.split(",")[0]?.trim();

  if (!defaultTelegramId) {
    console.log("No default Telegram ID configured. Skipping seed.");
    return;
  }

  const user = await ensureUser({
    telegramId: defaultTelegramId,
    firstName: "Justin"
  });

  await prisma.food.upsert({
    where: {
      userId_name: {
        userId: user.id,
        name: "protein"
      }
    },
    update: {
      defaultCalories: 115,
    },
    create: {
      userId: user.id,
      name: "protein",
      defaultCalories: 115
    }
  });

  console.log(`Seeded default user ${user.telegramId}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
