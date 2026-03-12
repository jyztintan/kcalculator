import type { FastifyInstance } from "fastify";
import { foodCreateSchema, mealEntryCreateSchema, reminderCreateSchema } from "@kcalculator/shared";
import { prisma } from "../lib/prisma.js";
import { getDashboardAnalytics } from "../services/analytics.js";
import { ensureUser, getUserByTelegramId, resolveDefaultUser } from "../services/users.js";

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function toDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.get("/users/default", async () => {
    const user = await resolveDefaultUser();
    return { user };
  });

  app.post("/users/sync", async (request) => {
    const body = request.body as { telegramId: string; username?: string; firstName?: string };
    const user = await ensureUser(body);
    return { user };
  });

  app.get("/foods", async (request) => {
    const query = request.query as { telegramId: string };
    const user = await getUserByTelegramId(query.telegramId);
    if (!user) {
      return { foods: [] };
    }

    const foods = await prisma.food.findMany({
      where: { userId: user.id },
    });

    return { foods };
  });

  app.post("/foods", async (request) => {
    const body = foodCreateSchema.parse(request.body);
    const food = await prisma.food.upsert({
      where: {
        userId_slug: {
          userId: body.userId,
          slug: slugify(body.name)
        }
      },
      update: {
        defaultCalories: body.defaultCalories,
        defaultMealType: body.defaultMealType
      },
      create: {
        userId: body.userId,
        name: body.name,
        slug: slugify(body.name),
        defaultCalories: body.defaultCalories,
        defaultMealType: body.defaultMealType
      }
    });

    return { food };
  });

  app.get("/entries", async (request) => {
    const query = request.query as { telegramId: string; date?: string };
    const user = await getUserByTelegramId(query.telegramId);
    if (!user) {
      return { entries: [] };
    }

    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const start = toDate(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const entries = await prisma.mealEntry.findMany({
      where: {
        userId: user.id,
        entryDate: { gte: start, lt: end }
      },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }]
    });

    return { entries };
  });

  app.post("/entries", async (request) => {
    const body = mealEntryCreateSchema.parse(request.body);
    const food = await prisma.food.findFirst({
      where: { userId: body.userId, slug: slugify(body.foodName) }
    });

    const entry = await prisma.mealEntry.create({
      data: {
        userId: body.userId,
        foodId: food?.id,
        entryDate: toDate(body.entryDate),
        mealType: body.mealType,
        foodName: body.foodName,
        calories: body.calories,
        quantity: body.quantity,
        source: body.source,
        notes: body.notes
      }
    });

    if (!food) {
      await prisma.food.create({
        data: {
          userId: body.userId,
          name: body.foodName,
          slug: slugify(body.foodName),
          defaultCalories: body.calories,
          defaultMealType: body.mealType
        }
      });
    }

    return { entry };
  });

  app.patch("/entries/:entryId", async (request) => {
    const params = request.params as { entryId: string };
    const body = request.body as Partial<{
      calories: number;
      foodName: string;
      mealType: "breakfast" | "lunch" | "dinner" | "snack";
      quantity: string;
      notes: string;
    }>;

    const entry = await prisma.mealEntry.update({
      where: { id: params.entryId },
      data: body
    });

    return { entry };
  });

  app.get("/dashboard", async (request) => {
    const query = request.query as { telegramId?: string; days?: string };
    const days = Number(query.days ?? 90);

    const user = query.telegramId
      ? await getUserByTelegramId(query.telegramId)
      : await resolveDefaultUser();

    if (!user) {
      return {
        summary: null,
        trend: [],
        topFoods: []
      };
    }

    return getDashboardAnalytics({ userId: user.id, days });
  });

  app.get("/targets", async (request) => {
    const query = request.query as { telegramId?: string };
    const user = query.telegramId
      ? await getUserByTelegramId(query.telegramId)
      : await resolveDefaultUser();

    if (!user) {
      return { targets: [] };
    }

    const targets = await prisma.dailyTarget.findMany({
      where: { userId: user.id },
      orderBy: { targetDate: "desc" },
      take: 30
    });

    return { targets };
  });

  app.post("/targets", async (request) => {
    const body = request.body as { userId: string; targetDate: string; targetCalories: number };
    const target = await prisma.dailyTarget.upsert({
      where: {
        userId_targetDate: {
          userId: body.userId,
          targetDate: toDate(body.targetDate)
        }
      },
      update: { targetCalories: body.targetCalories },
      create: {
        userId: body.userId,
        targetDate: toDate(body.targetDate),
        targetCalories: body.targetCalories
      }
    });

    return { target };
  });

  app.get("/reminders", async (request) => {
    const query = request.query as { telegramId: string };
    const user = await getUserByTelegramId(query.telegramId);
    if (!user) {
      return { reminders: [] };
    }

    const reminders = await prisma.reminder.findMany({
      where: { userId: user.id },
      orderBy: [{ hour: "asc" }, { minute: "asc" }]
    });

    return { reminders };
  });

  app.post("/reminders", async (request) => {
    const body = reminderCreateSchema.parse(request.body);
    const reminder = await prisma.reminder.create({
      data: body
    });

    return { reminder };
  });
}
