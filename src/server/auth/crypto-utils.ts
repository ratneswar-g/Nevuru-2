// @ts-nocheck
import crypto from "node:crypto";

const DEFAULT_DEV_FALLBACK_SECRET = "neravu-internal-dev-hmac-secret-do-not-use-in-prod-9f8a7b6c5d4e3f2a";

function getServerAuthSecret(): string {
  const isProduction = process.env.NODE_ENV === "production";
  const envSecret = process.env.AUTH_SESSION_SECRET;

  if (isProduction) {
    if (!envSecret || envSecret.trim().length === 0) {
      throw new Error(
        "[Neravu Auth] Fatal configuration error: AUTH_SESSION_SECRET environment variable is missing in production. A secure secret (minimum 32 characters) must be supplied through the environment."
      );
    }
    const trimmed = envSecret.trim();
    if (trimmed.length < 32) {
      throw new Error(
        `[Neravu Auth] Fatal configuration error: AUTH_SESSION_SECRET is insufficient in production (length: ${trimmed.length} characters). Production secret must be at least 32 characters.`
      );
    }
    return trimmed;
  }

  // Development / test fallback behavior
  if (envSecret && envSecret.trim().length >= 16) {
    return envSecret.trim();
  }
  return DEFAULT_DEV_FALLBACK_SECRET;
}

function validateE164Phone(input: string | undefined | null) {
  if (!input || typeof input !== "string") {
    return { valid: false, normalized: "", error: "Phone number is required." };
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith("+")) {
    return {
      valid: false,
      normalized: "",
      error: 'Phone number must be in E.164 format starting with "+" and country code (e.g. +919876543210).',
    };
  }
  const stripped = "+" + trimmed.slice(1).replace(/[\s\-]/g, "");
  const e164Regex = /^\+[1-9]\d{7,14}$/;
  if (!e164Regex.test(stripped)) {
    return {
      valid: false,
      normalized: "",
      error: 'Invalid E.164 phone number. Must contain "+" followed by 8 to 15 digits with no letters or leading zero.',
    };
  }
  return { valid: true, normalized: stripped };
}

function maskPhoneNumber(phone: string | undefined | null): string {
  if (!phone || typeof phone !== "string") return "***";
  const cleaned = phone.replace(/\s+/g, "");
  if (cleaned.length <= 6) {
    return "***" + cleaned.slice(-2);
  }
  const prefix = cleaned.slice(0, 3);
  const suffix = cleaned.slice(-4);
  const maskedMiddleLen = Math.max(4, cleaned.length - 7);
  return `${prefix}${"*".repeat(maskedMiddleLen)}${suffix}`;
}

function generateSecureOtpCode(): string {
  const num = crypto.randomInt(100000, 1000000);
  return String(num).padStart(6, "0");
}

function generateSecureSessionToken(): string {
  const randomHex = crypto.randomBytes(32).toString("hex");
  return `nrv_sess_${randomHex}`;
}

function hashOtpCode(referenceId: string, normalizedPhone: string, code: string): string {
  const secret = getServerAuthSecret();
  return crypto
    .createHmac("sha256", secret)
    .update(`otp:${referenceId}:${normalizedPhone}:${code.trim()}`)
    .digest("hex");
}

function verifyOtpHashConstantTime(
  referenceId: string,
  normalizedPhone: string,
  candidateCode: string,
  storedHashHex: string
): boolean {
  if (!candidateCode || !storedHashHex) return false;
  try {
    const computedHex = hashOtpCode(referenceId, normalizedPhone, candidateCode);
    const bufA = Buffer.from(computedHex, "hex");
    const bufB = Buffer.from(storedHashHex, "hex");
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function hashSessionToken(rawToken: string): string {
  const secret = getServerAuthSecret();
  return crypto
    .createHmac("sha256", secret)
    .update(`session:${rawToken.trim()}`)
    .digest("hex");
}

function verifyTokenHashConstantTime(computedHashHex: string, storedHashHex: string): boolean {
  if (!computedHashHex || !storedHashHex) return false;
  try {
    const bufA = Buffer.from(computedHashHex, "hex");
    const bufB = Buffer.from(storedHashHex, "hex");
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function sanitizeAuditMetadata(metadata: Record<string, any> | undefined | null): Record<string, any> {
  if (!metadata || typeof metadata !== "object") return {};
  const forbiddenKeys = new Set([
    "otp",
    "code",
    "otpcode",
    "rawotp",
    "token",
    "rawtoken",
    "bearertoken",
    "sessiontoken",
    "password",
    "secret",
  ]);
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();
    if (forbiddenKeys.has(lowerKey)) {
      continue;
    }
    if ((lowerKey.includes("phone") || lowerKey === "mobile" || lowerKey === "recipient") && typeof value === "string") {
      sanitized[key] = maskPhoneNumber(value);
    } else if (typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value.replace(/[\s\-]/g, ""))) {
      sanitized[key] = maskPhoneNumber(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export {
  getServerAuthSecret,
  generateSecureOtpCode,
  generateSecureSessionToken,
  hashOtpCode,
  hashSessionToken,
  maskPhoneNumber,
  sanitizeAuditMetadata,
  validateE164Phone,
  verifyOtpHashConstantTime,
  verifyTokenHashConstantTime,
};
