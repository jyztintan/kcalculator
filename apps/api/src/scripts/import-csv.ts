import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { ensureUser } from "../services/users.js";

function parseDate(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00.000Z`);
  }

  const [day, month, year] = trimmed.split(/[/-]/).map((part) => Number(part));
  if (day && month && year) {
    return new Date(Date.UTC(year, month - 1, day));
  }

  throw new Error(`Unsupported date format: ${value}`);
}

function pick(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const match = Object.entries(row).find(([column]) => column.trim().toLowerCase() === key);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

async function main() {
  const importFile = process.env.IMPORT_FILE;
  const telegramId =
    process.env.IMPORT_TELEGRAM_ID ||
    env.DEFAULT_DASHBOARD_TELEGRAM_ID ||
    env.TELEGRAM_ALLOWED_USER_IDS.split(",")[0]?.trim();

  if (!importFile) {
    throw new Error("Set IMPORT_FILE=/absolute/path/to/google-sheet-export.csv");
  }

  if (!telegramId) {
    throw new Error("Set IMPORT_TELEGRAM_ID or DEFAULT_DASHBOARD_TELEGRAM_ID before importing.");
  }

  const csv = await readFile(importFile, "utf8");
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true
  }) as Array<Record<string, string>>;

  const user = await ensureUser({ telegramId });

  for (const row of rows) {
    const rawDate = pick(row, ["date", "date (present)", "date (prisine)"]);
    const rawFood = pick(row, ["food", "meal", "item"]);
    const rawCalories = pick(row, ["calories", "kcal"]);
    const rawTarget = pick(row, ["target", "daily target"]);
    const rawMealType = pick(row, ["meal type", "mealtype"]);

    if (!rawDate || !rawCalories) {
      continue;
    }

    const entryDate = parseDate(rawDate);
    const calories = Number(rawCalories);

    if (!Number.isFinite(calories) || calories <= 0) {
      continue;
    }

    if (rawFood) {
      await prisma.mealEntry.create({
        data: {
          userId: user.id,
          entryDate,
          mealType:
            rawMealType === "breakfast" ||
            rawMealType === "lunch" ||
            rawMealType === "dinner" ||
            rawMealType === "snack"
              ? rawMealType
              : "snack",
          foodName: rawFood,
          calories,
          source: "manual"
        }
      });
    }

    if (rawTarget) {
      const targetCalories = Number(rawTarget);
      if (Number.isFinite(targetCalories) && targetCalories > 0) {
        await prisma.dailyTarget.upsert({
          where: {
            userId_targetDate: {
              userId: user.id,
              targetDate: entryDate
            }
          },
          update: {
            targetCalories
          },
          create: {
            userId: user.id,
            targetDate: entryDate,
            targetCalories
          }
        });
      }
    }
  }

  console.log(`Imported ${rows.length} rows for Telegram user ${telegramId}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
