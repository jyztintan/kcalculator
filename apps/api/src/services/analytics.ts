import { prisma } from "../lib/prisma.js";
import { addDays, dateKeyToUtcMidnight, getLocalDateKey } from "./dates.js";

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
      remaining
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
      weeklyAverage: activeDays === 0 ? 0 : Math.round(totalCalories / activeDays),
      adherenceRate,
      hitDays,
      missedDays,
      trackedDays: activeDays
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

export async function getTodaySummaryText(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  const timezone = user?.timezone ?? "UTC";
  const todayKey = getLocalDateKey(timezone);
  const today = dateKeyToUtcMidnight(todayKey);
  const tomorrow = addDays(today, 1);

  const [analytics, entries] = await Promise.all([
    getDashboardAnalytics({ userId, days: 7 }),
    prisma.mealEntry.findMany({
      where: {
        userId,
        entryDate: {
          gte: today,
          lt: tomorrow,
        },
      },
      orderBy: { createdAt: "asc" },
      select: {
        foodName: true,
        calories: true,
      },
    }),
  ]);
  const summary = analytics.summary;

  const linesToday =
    entries.length === 0
      ? ["(no entries yet)"]
      : entries.map(
          (e: { foodName: string; calories: number }) =>
            `- ${e.foodName} (${e.calories} kcal)`,
        );

  return [
    "Logged today:",
    ...linesToday,
    "",
    `Today: ${summary.todayCalories}/${summary.todayTarget} kcal`,
    `Remaining: ${summary.todayRemaining} kcal`,
    `7-day avg: ${summary.weeklyAverage} kcal`,
    `Hit days: ${summary.hitDays}, Missed days: ${summary.missedDays}`,
  ].join("\n");
}
