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
    env.TELEGRAM_ALLOWED_USER_IDS.split(",")[0]?.trim();

  if (!importFile) {
    throw new Error("Set IMPORT_FILE=/absolute/path/to/google-sheet-export.csv");
  }

  if (!telegramId) {
    throw new Error("Set TELEGRAM_ALLOWED_USER_IDS before importing.");
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

    if (!rawDate || !rawCalories) {
      continue;
    }

    const entryDate = parseDate(rawDate);
    const calories = Number(rawCalories);

    if (!Number.isFinite(calories)) {
      console.log(`Skipping row with invalid calories: ${rawDate} ${rawFood} ${rawCalories}`);
      continue;
    }

    if (rawFood) {
      await prisma.mealEntry.create({
        data: {
          userId: user.id,
          entryDate,
          foodName: rawFood,
          calories,
          source: "manual"
        }
      });
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
