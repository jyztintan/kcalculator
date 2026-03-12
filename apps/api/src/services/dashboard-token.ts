import crypto from "node:crypto";

function base64UrlEncode(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecodeToBuffer(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

type DashboardTokenPayload = {
  telegramId: string;
  exp: number; // unix seconds
};

export function issueDashboardToken(input: {
  telegramId: string;
  expiresInSeconds: number;
}) {
  const payload: DashboardTokenPayload = {
    telegramId: input.telegramId,
    exp: Math.floor(Date.now() / 1000) + input.expiresInSeconds,
  };

  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sigB64 = base64UrlEncode(
    crypto.createHmac("sha256", input.telegramId).update(payloadB64).digest(),
  );

  return `${payloadB64}.${sigB64}`;
}

export function verifyDashboardToken(input: { token: string; secret: string }): DashboardTokenPayload | null {
  const [payloadB64, sigB64, extra] = input.token.split(".");
  if (!payloadB64 || !sigB64 || extra) return null;

  const expectedSigB64 = base64UrlEncode(
    crypto.createHmac("sha256", input.secret).update(payloadB64).digest(),
  );
  const sigOk = crypto.timingSafeEqual(
    Buffer.from(expectedSigB64, "utf8"),
    Buffer.from(sigB64, "utf8"),
  );
  if (!sigOk) return null;

  let payload: DashboardTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecodeToBuffer(payloadB64).toString("utf8")) as DashboardTokenPayload;
  } catch {
    return null;
  }

  if (!payload?.telegramId || typeof payload.telegramId !== "string") return null;
  if (!payload?.exp || typeof payload.exp !== "number") return null;
  if (Math.floor(Date.now() / 1000) > payload.exp) return null;

  return payload;
}

