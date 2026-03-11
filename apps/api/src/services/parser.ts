import OpenAI from "openai";
import { parseLogResultSchema, type ParseLogResult } from "@kcalculator/shared";
import { env } from "../config/env.js";

const mealKeywords = ["breakfast", "lunch", "dinner", "snack"] as const;

const openai = env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: env.OPENAI_API_KEY
    })
  : null;

function detectMealType(text: string): ParseLogResult["mealType"] {
  return mealKeywords.find((keyword) => text.includes(keyword));
}

function heuristicParse(message: string): ParseLogResult {
  const normalized = message.trim().toLowerCase();
  const caloriesMatch = normalized.match(/(\d{2,5})\s*(kcal|cal)?\b/);
  const mealType = detectMealType(normalized);
  const entryDate = new Date().toISOString().slice(0, 10);

  const rawFoodName = normalized
    .replace(/^(had|ate|log|logged)\s+/, "")
    .replace(/\bfor\s+(breakfast|lunch|dinner|snack)\b/g, "")
    .replace(/\b(breakfast|lunch|dinner|snack)\b/g, "")
    .replace(/(\d{2,5})\s*(kcal|cal)?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const foodName = rawFoodName || undefined;

  const confidence =
    caloriesMatch && mealType && foodName ? 0.92 : caloriesMatch && foodName ? 0.78 : 0.35;

  return parseLogResultSchema.parse({
    confidence,
    entryDate,
    mealType,
    foodName,
    calories: caloriesMatch ? Number(caloriesMatch[1]) : undefined,
    clarification:
      confidence >= 0.7 ? undefined : "I could not confidently detect the meal type or calories."
  });
}

async function llmParse(message: string): Promise<ParseLogResult | null> {
  if (!openai) {
    return null;
  }

  const completion = await openai.responses.create({
    model: env.OPENAI_MODEL,
    temperature: 0,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "Extract a calorie log into JSON.",
              "Return only JSON with keys: confidence, entryDate, mealType, foodName, calories, quantity, notes, clarification.",
              "mealType must be one of breakfast,lunch,dinner,snack when present.",
              "Use today's date if no date is given."
            ].join(" ")
          }
        ]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: message }]
      }
    ]
  });

  const text = completion.output_text;
  if (!text) {
    return null;
  }

  try {
    return parseLogResultSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function parseLogMessage(message: string) {
  const heuristic = heuristicParse(message);
  const llmResult = await llmParse(message);

  if (llmResult && llmResult.confidence > heuristic.confidence) {
    return llmResult;
  }

  return heuristic;
}
