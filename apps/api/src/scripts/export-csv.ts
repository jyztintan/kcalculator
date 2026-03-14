import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "csv-stringify/sync";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { getUserByTelegramId } from "../services/users.js";

async function main() {
  const outputDir = process.env.EXPORT_DIR ?? "exports";
  const telegramId =
    process.env.EXPORT_TELEGRAM_ID ||
    env.TELEGRAM_ALLOWED_USER_IDS.split(",")[0]?.trim();

  if (!telegramId) {
    throw new Error("Set EXPORT_TELEGRAM_ID or TELEGRAM_ALLOWED_USER_IDS before exporting.");
  }

  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    throw new Error(`User ${telegramId} not found`);
  }

  const entries = await prisma.mealEntry.findMany({
    where: { userId: user.id },
    orderBy: { entryDate: "asc" }
  });

  await mkdir(outputDir, { recursive: true });

  const entriesCsv = stringify(
    entries.map((entry: { entryDate: Date; foodName: string; calories: number }) => ({
      date: entry.entryDate.toISOString().slice(0, 10),
      food: entry.foodName,
      calories: entry.calories,
    })),
    { header: true }
  );

  await writeFile(join(outputDir, "entries.csv"), entriesCsv, "utf8");

  console.log(`Exported entries to ${outputDir}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
