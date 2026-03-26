import OpenAI from "openai";
import { parseLogResultSchema, type ParseLogResult } from "@kcalculator/shared";
import { env } from "../config/env.js";
import { getLocalDateKey } from "./dates.js";

const openai = env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    })
  : null;

export async function parseLogMessage(message: string, timezone: string) {
  const normalized = message.trim().toLowerCase();
  const rawFoodName = normalized
    .replace(/^(had|ate|log|logged)\s+/, "")
    .replace(/(-?\d{2,5})\s*(kcal|cal)?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const foodName = rawFoodName || undefined;
  const caloriesMatch = normalized.match(/(-?\d{2,5})\s*(kcal|cal)?\b/);

  return {
    entryDate: getLocalDateKey(timezone),
    foodName: foodName,
    calories: caloriesMatch ? Number(caloriesMatch[1]) : undefined,
    confidence: 0.99,
  };
}

export async function parseBacklogMessage(
  message: string,
  _timezone: string,
): Promise<ParseLogResult | null> {
  const trimmed = message.trim();

  // Expect a leading ISO date, e.g. "2026-03-10 chicken rice 650"
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
  if (!match) {
    return null;
  }

  const [, datePart, rest] = match;
  const normalized = rest.trim().toLowerCase();

  const rawFoodName = normalized
    .replace(/^(had|ate|log|logged)\s+/, "")
    .replace(/(-?\d{2,5})\s*(kcal|cal)?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const foodName = rawFoodName || undefined;
  const caloriesMatch = normalized.match(/(-?\d{2,5})\s*(kcal|cal)?\b/);

  return {
    entryDate: datePart,
    foodName,
    calories: caloriesMatch ? Number(caloriesMatch[1]) : undefined,
    confidence: 0.99,
  };
}
