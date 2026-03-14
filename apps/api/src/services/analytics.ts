import { prisma } from "../lib/prisma.js";
import {
  addDays,
  addDaysToDateKey,
  dateKeyToUtcMidnight,
  getLocalDateKey,
  normalizeDateKey,
} from "./dates.js";

type AnalyticsInput = {
  userId: string;
  days: number;
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function getDashboardAnalytics({ userId, days }: AnalyticsInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  const timezone = user?.timezone ?? "UTC";
  const todayKey = getLocalDateKey(timezone);
  const today = dateKeyToUtcMidnight(todayKey);
  const startDate = addDays(today, -(days - 1));
  const endDate = addDays(today, 1);

  const [entries, recentFoods] = await Promise.all([
    prisma.mealEntry.findMany({
      where: {
        userId,
        entryDate: {
          gte: startDate,
          lt: endDate,
        },
      },
      orderBy: { entryDate: "asc" },
    }),
    prisma.mealEntry.groupBy({
      by: ["foodName"],
      where: {
        userId,
        entryDate: {
          gte: startDate,
          lt: endDate,
        },
      },
      _sum: { calories: true },
      _count: { _all: true },
      orderBy: {
        _sum: {
          calories: "desc",
        },
      },
      take: 10,
    }),
  ]);

  const totalsByDay = new Map<string, number>();
  for (const entry of entries) {
    const key = formatDate(entry.entryDate);
    totalsByDay.set(key, (totalsByDay.get(key) ?? 0) + entry.calories);
  }

  const trend = [];
  let hitDays = 0;
  let missedDays = 0;
  let totalCalories = 0;
  let activeDays = 0;

  for (
    let cursor = new Date(startDate);
    cursor < endDate;
    cursor = addDays(cursor, 1)
  ) {
    const dateKey = formatDate(cursor);
    const calories = totalsByDay.get(dateKey) ?? 0;
    const target = user?.defaultCalorieTarget ?? 0;
    const metGoal = calories > 0 && calories <= target;
    const exceededBy = calories > target ? calories - target : 0;
    const remaining = calories > 0 ? Math.max(target - calories, 0) : target;

    if (calories > 0) {
      activeDays += 1;
      totalCalories += calories;
      if (metGoal) {
        hitDays += 1;
      } else if (calories > target) {
        missedDays += 1;
      }
    }

    trend.push({
      date: dateKey,
      calories,
      target,
      targetHit: metGoal ? calories : 0,
      targetMissed: calories > target ? calories : 0,
      exceededBy,
      remaining,
    });
  }

  const todayCalories = totalsByDay.get(todayKey) ?? 0;
  const todayTarget = user?.defaultCalorieTarget ?? 0;
  const adherenceRate = activeDays === 0 ? 0 : hitDays / activeDays;

  return {
    summary: {
      todayCalories,
      todayTarget,
      todayRemaining: Math.max(todayTarget - todayCalories, 0),
      weeklyAverage:
        activeDays === 0 ? 0 : Math.round(totalCalories / activeDays),
      adherenceRate,
      hitDays,
      missedDays,
      trackedDays: activeDays,
    },
    trend,
    topFoods: recentFoods.map(
      (food: {
        foodName: string;
        _sum: { calories: number | null };
        _count: { _all: number };
      }) => ({
        foodName: food.foodName,
        totalCalories: food._sum.calories ?? 0,
        count: food._count._all,
      }),
    ),
  };
}

/** Resolve dateArg to a date key (YYYY-MM-DD or DD-MM-YYYY). "" | "today" → today, "yesterday" → yesterday, or a date string. */
function resolveDateKey(timezone: string, dateArg: string | undefined): string {
  const todayKey = getLocalDateKey(timezone);
  if (!dateArg || dateArg.toLowerCase() === "today") return todayKey;
  if (dateArg.toLowerCase() === "yesterday")
    return addDaysToDateKey(normalizeDateKey(todayKey), -1);
  if (
    /^\d{2}-\d{2}-\d{4}$/.test(dateArg) ||
    /^\d{4}-\d{2}-\d{2}$/.test(dateArg)
  )
    return dateArg;
  return "";
}

function formatDayLabel(
  timezone: string,
  dateKey: string,
  todayKey: string,
): string {
  const key = normalizeDateKey(dateKey);
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  });
}

export async function getDaySummaryText(
  userId: string,
  dateArg?: string,
): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  const timezone = user?.timezone ?? "UTC";
  const todayKey = getLocalDateKey(timezone);
  const dateKey = resolveDateKey(timezone, dateArg);
  if (!dateKey) return "Invalid date format. Use YYYY-MM-DD or DD-MM-YYYY.";
  const dayLabel = formatDayLabel(timezone, dateKey, todayKey);

  const start = dateKeyToUtcMidnight(dateKey);
  const end = addDays(start, 1);
  const dateKeyNorm = normalizeDateKey(dateKey);
  const todayKeyNorm = normalizeDateKey(todayKey);

  const entries = await prisma.mealEntry.findMany({
    where: {
      userId,
      entryDate: { gte: start, lt: end },
    },
    orderBy: { createdAt: "asc" },
    select: { foodName: true, calories: true },
  });

  const totalCalories = entries.reduce(
    (sum: number, e: { calories: number }) => sum + e.calories,
    0,
  );
  const target = user?.defaultCalorieTarget ?? 0;
  const remaining = Math.max(0, target - totalCalories);

  const lines =
    entries.length === 0
      ? ["hungry boi... never eat ah?"]
      : entries.map(
          (e: { foodName: string; calories: number }) =>
            `- ${e.foodName} (${e.calories} kcal)`,
        );

  const message = formatDayText(
    lines,
    totalCalories,
    dayLabel,
    target,
    remaining,
  );
  const scolding =
    totalCalories > target
      ? "KNN fatty today you exceed again... next time can control a bit anot? 🤡"
      : "";
  if (dateKeyNorm === todayKeyNorm && totalCalories > target) {
    return `${message}${scolding}`;
  }
  return message;
}

export async function getWeekSummaryText(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  const timezone = user?.timezone ?? "UTC";
  const todayKey = getLocalDateKey(timezone);
  const today = dateKeyToUtcMidnight(todayKey);
  const target = user?.defaultCalorieTarget ?? 0;

  const startDate = addDays(today, -6);
  const endDate = addDays(today, 1);

  const analytics = await getDashboardAnalytics({ userId, days: 7 });
  const dayBlocks: string[] = [];

  for (
    let cursor = new Date(startDate);
    cursor < endDate;
    cursor = addDays(cursor, 1)
  ) {
    const dateKey = cursor.toISOString().slice(0, 10);
    const dayStart = new Date(cursor);
    const dayEnd = addDays(dayStart, 1);
    const dayLabel = formatDayLabel(timezone, dateKey, todayKey);

    const entries = await prisma.mealEntry.findMany({
      where: {
        userId,
        entryDate: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { createdAt: "asc" },
      select: { foodName: true, calories: true },
    });

    const totalCalories = entries.reduce(
      (sum: number, e: { calories: number }) => sum + e.calories,
      0,
    );
    const remaining = Math.max(0, target - totalCalories);
    const lines =
      entries.length === 0
        ? ["hungry boi... never eat ah?"]
        : entries.map(
            (e: { foodName: string; calories: number }) =>
              `- ${e.foodName} (${e.calories} kcal)`,
          );
    dayBlocks.push(
      formatDayText(lines, totalCalories, dayLabel, target, remaining),
    );
  }

  const adherenceRate = analytics.summary.adherenceRate * 100;
  const adherenceRateText =
    adherenceRate > 85 ? "🤩" : adherenceRate > 50 ? "🤨" : "💩";
  const summary = [
    "===========================",
    "===========================",
    `Hit days: ${analytics.summary.hitDays}`,
    `Missed days: ${analytics.summary.missedDays}`,
    `Avg calories: ${analytics.summary.weeklyAverage}`,
    `Adherence: ${adherenceRate.toFixed(2)}% ${adherenceRateText}`,
  ].join("\n");
  return dayBlocks.join("\n") + "\n" + summary;
}

export async function getMonthSummaryText(userId: string): Promise<string> {
  const analytics = await getDashboardAnalytics({ userId: userId, days: 30 });
  const adherenceRate = analytics.summary.adherenceRate * 100;
  const adherenceRateText =
    adherenceRate > 85 ? "🤩" : adherenceRate > 50 ? "🤨" : "💩";
  return [
    `Hit days: ${analytics.summary.hitDays}`,
    `Missed days: ${analytics.summary.missedDays}`,
    `Avg calories: ${analytics.summary.weeklyAverage}`,
    `Adherence: ${adherenceRate.toFixed(2)}% ${adherenceRateText}`,
  ].join("\n");
}

function formatDayText(
  lines: string[],
  totalCalories: number,
  dateLabel: string,
  target: number,
  remaining: number,
) {
  return [
    `bro you devoured ${totalCalories} kcal on ${dateLabel}`,
    ...lines,
    "",
    `Total: ${totalCalories}/${target} kcal`,
    `Remaining: ${remaining} kcal`,
    "",
  ].join("\n");
}
