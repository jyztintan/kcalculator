import { z } from "zod";

export const reminderTypeValues = ["log_meal", "weigh_in", "custom"] as const;

export const reminderTypeSchema = z.enum(reminderTypeValues);
export type ReminderType = z.infer<typeof reminderTypeSchema>;

export const mealEntryCreateSchema = z.object({
  userId: z.string().cuid(),
  entryDate: z.string(),
  foodName: z.string().min(1),
  calories: z.number().int(),
  source: z.enum(["manual", "favourite", "parsed"]).default("manual"),
});

export const foodCreateSchema = z.object({
  userId: z.string().cuid(),
  name: z.string().min(1),
  defaultCalories: z.number().int(),
});

export const reminderCreateSchema = z.object({
  userId: z.string().cuid(),
  label: z.string().min(1),
  type: reminderTypeSchema,
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  timezone: z.string().min(1),
  enabled: z.boolean().default(true),
});

export const parseLogResultSchema = z.object({
  confidence: z.number().min(0).max(1),
  entryDate: z.string(),
  foodName: z.string().optional(),
  calories: z.number().int().optional(),
  clarification: z.string().optional(),
});

export type MealEntryCreateInput = z.infer<typeof mealEntryCreateSchema>;
export type FoodCreateInput = z.infer<typeof foodCreateSchema>;
export type ReminderCreateInput = z.infer<typeof reminderCreateSchema>;
export type ParseLogResult = z.infer<typeof parseLogResultSchema>;
