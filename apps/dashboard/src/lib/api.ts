const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export type DashboardPayload = {
  summary: {
    todayCalories: number;
    todayTarget: number;
    todayRemaining: number;
    weeklyAverage: number;
    adherenceRate: number;
    hitDays: number;
    missedDays: number;
    trackedDays: number;
  } | null;
  trend: Array<{
    date: string;
    calories: number;
    target: number;
    targetHit: number;
    targetMissed: number;
    exceededBy: number;
    remaining: number;
  }>;
  topFoods: Array<{
    foodName: string;
    totalCalories: number;
    count: number;
  }>;
};

export async function fetchDashboard(days = 90, telegramId?: string): Promise<DashboardPayload> {
  const url = new URL("/dashboard", apiBaseUrl);
  url.searchParams.set("days", String(days));
  if (telegramId) {
    url.searchParams.set("telegramId", telegramId);
  }

  const response = await fetch(url.toString(), {
    next: { revalidate: 0 }
  });

  if (!response.ok) {
    throw new Error("Failed to load dashboard data");
  }

  return response.json();
}
