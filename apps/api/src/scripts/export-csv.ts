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
    env.DEFAULT_DASHBOARD_TELEGRAM_ID ||
    env.TELEGRAM_ALLOWED_USER_IDS.split(",")[0]?.trim();

  if (!telegramId) {
    throw new Error("Set EXPORT_TELEGRAM_ID or DEFAULT_DASHBOARD_TELEGRAM_ID before exporting.");
  }

  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    throw new Error(`User ${telegramId} not found`);
  }

  const [entries, targets] = await Promise.all([
    prisma.mealEntry.findMany({
      where: { userId: user.id },
      orderBy: { entryDate: "asc" }
    }),
    prisma.dailyTarget.findMany({
      where: { userId: user.id },
      orderBy: { targetDate: "asc" }
    })
  ]);

  await mkdir(outputDir, { recursive: true });

  const entriesCsv = stringify(
    entries.map((entry) => ({
      date: entry.entryDate.toISOString().slice(0, 10),
      mealType: entry.mealType,
      food: entry.foodName,
      calories: entry.calories,
      quantity: entry.quantity ?? "",
      notes: entry.notes ?? ""
    })),
    { header: true }
  );

  const targetsCsv = stringify(
    targets.map((target) => ({
      date: target.targetDate.toISOString().slice(0, 10),
      targetCalories: target.targetCalories
    })),
    { header: true }
  );

  await Promise.all([
    writeFile(join(outputDir, "entries.csv"), entriesCsv, "utf8"),
    writeFile(join(outputDir, "targets.csv"), targetsCsv, "utf8")
  ]);

  console.log(`Exported entries and targets to ${outputDir}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
