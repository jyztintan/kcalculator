import type { FastifyInstance } from "fastify";
import {
  foodCreateSchema,
  mealEntryCreateSchema,
  reminderCreateSchema,
} from "@kcalculator/shared";
import { prisma } from "../lib/prisma.js";
import {
  ensureUser,
  getUserByTelegramId,
  resolveDefaultUser,
} from "../services/users.js";
import { dateKeyToUtcMidnight, getLocalDateKey, addDays } from "../services/dates.js";

function normaliseName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.get("/users/default", async () => {
    const user = await resolveDefaultUser();
    return { user };
  });

  app.post("/users/sync", async (request) => {
    const body = request.body as {
      telegramId: string;
      username?: string;
      firstName?: string;
    };
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
        userId_name: {
          userId: body.userId,
          name: body.name.trim(),
        },
      },
      update: {
        defaultCalories: body.defaultCalories,
      },
      create: {
        userId: body.userId,
        name: body.name.trim(),
        defaultCalories: body.defaultCalories,
      },
    });

    return { food };
  });

  app.get("/entries", async (request) => {
    const query = request.query as { telegramId: string; date?: string };
    const user = await getUserByTelegramId(query.telegramId);
    if (!user) {
      return { entries: [] };
    }

    const timezone = user.timezone;
    const dateKey = query.date ?? getLocalDateKey(timezone);
    const start = dateKeyToUtcMidnight(dateKey);
    const end = addDays(start, 1);

    const entries = await prisma.mealEntry.findMany({
      where: {
        userId: user.id,
        entryDate: { gte: start, lt: end },
      },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
    });

    return { entries };
  });

  app.post("/entries", async (request) => {
    const body = mealEntryCreateSchema.parse(request.body);
    const foods = await prisma.food.findMany({ where: { userId: body.userId } });
    const food =
      foods.find(
        (f: { name: string }) =>
          normaliseName(f.name) === normaliseName(body.foodName),
      ) ?? null;

    const entry = await prisma.mealEntry.create({
      data: {
        userId: body.userId,
        foodId: food?.id,
        entryDate: dateKeyToUtcMidnight(body.entryDate),
        foodName: body.foodName,
        calories: body.calories,
        source: body.source,
      },
    });

    if (!food) {
      await prisma.food.create({
        data: {
          userId: body.userId,
          name: body.foodName.trim(),
          defaultCalories: body.calories,
        },
      });
    }

    return { entry };
  });

  app.patch("/entries/:entryId", async (request) => {
    const params = request.params as { entryId: string };
    const body = request.body as Partial<{
      calories: number;
      foodName: string;
    }>;

    const entry = await prisma.mealEntry.update({
      where: { id: params.entryId },
      data: body,
    });

    return { entry };
  });

  app.get("/reminders", async (request) => {
    const query = request.query as { telegramId: string };
    const user = await getUserByTelegramId(query.telegramId);
    if (!user) {
      return { reminders: [] };
    }

    const reminders = await prisma.reminder.findMany({
      where: { userId: user.id },
      orderBy: [{ hour: "asc" }, { minute: "asc" }],
    });

    return { reminders };
  });

  app.post("/reminders", async (request) => {
    const body = reminderCreateSchema.parse(request.body);
    const reminder = await prisma.reminder.create({
      data: body,
    });

    return { reminder };
  });
}
