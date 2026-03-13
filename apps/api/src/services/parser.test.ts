import { describe, it, expect, vi } from "vitest";

vi.mock("../config/env.js", () => ({
  env: {
    DATABASE_URL: "postgres://test:test@localhost:5432/test",
    TELEGRAM_ALLOWED_USER_IDS: "",
    TELEGRAM_USE_WEBHOOK: "false",
    DEFAULT_CALORIE_TARGET: 2267,
    DEFAULT_TIMEZONE: "Asia/Singapore",
    DEFAULT_DASHBOARD_TELEGRAM_ID: "",
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: "gpt-4.1-mini",
  },
  allowedTelegramIds: new Set<number>(),
}));

import { parseLogMessage } from "./parser";
import { getLocalDateKey } from "./dates";

describe("parseLogMessage", () => {
  it("extracts food name and calories with kcal suffix", async () => {
    const timezone = "Asia/Singapore";
    const message = "Had pizza 500kcal";

    const result = await parseLogMessage(message, timezone);

    expect(result.foodName).toBe("pizza");
    expect(result.calories).toBe(500);
    expect(result.entryDate).toBe(getLocalDateKey(timezone));
  });

  it("handles cal suffix and extra spaces", async () => {
    const timezone = "Asia/Singapore";
    const message = "  ate   chicken rice   650 cal ";

    const result = await parseLogMessage(message, timezone);

    expect(result.foodName).toBe("chicken rice");
    expect(result.calories).toBe(650);
    expect(result.entryDate).toBe(getLocalDateKey(timezone));
  });

  it("works without explicit calorie unit", async () => {
    const timezone = "Asia/Singapore";
    const message = "logged ice cream 300";

    const result = await parseLogMessage(message, timezone);

    expect(result.foodName).toBe("ice cream");
    expect(result.calories).toBe(300);
    expect(result.entryDate).toBe(getLocalDateKey(timezone));
  });

  it("returns undefined foodName when only calories are given", async () => {
    const timezone = "Asia/Singapore";
    const message = "300";

    const result = await parseLogMessage(message, timezone);

    expect(result.foodName).toBeUndefined();
    expect(result.calories).toBe(300);
    expect(result.entryDate).toBe(getLocalDateKey(timezone));
  });

  it("does not extract calories from non-calorie units", async () => {
    const timezone = "Asia/Singapore";
    const message = "pizza 100kg";

    const result = await parseLogMessage(message, timezone);

    expect(result.foodName).toBe("pizza 100kg");
    expect(result.calories).toBeUndefined();
    expect(result.entryDate).toBe(getLocalDateKey(timezone));
  });
});

