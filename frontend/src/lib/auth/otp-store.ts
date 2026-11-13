import { randomInt, timingSafeEqual } from "node:crypto";

interface StoredOtp {
  code: string;
  expiresAt: number;
  attempts: number;
}

// In-memory OTP registry keyed by lowercase email
const otpMap = new Map<string, StoredOtp>();

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

/** Generates a cryptographically strong 6-digit numeric OTP */
export function generateOtp(email: string): string {
  const cleanEmail = email.trim().toLowerCase();
  const code = randomInt(100000, 999999).toString();
  otpMap.set(cleanEmail, {
    code,
    expiresAt: Date.now() + OTP_EXPIRY_MS,
    attempts: 0,
  });
  return code;
}

export function verifyOtp(email: string, codeInput: string): { valid: boolean; reason?: string } {
  const cleanEmail = email.trim().toLowerCase();
  const entry = otpMap.get(cleanEmail);

  if (!entry) {
    return { valid: false, reason: "No OTP requested or OTP has expired. Please request a new code." };
  }

  if (Date.now() > entry.expiresAt) {
    otpMap.delete(cleanEmail);
    return { valid: false, reason: "OTP has expired. Please request a new code." };
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    otpMap.delete(cleanEmail);
    return { valid: false, reason: "Too many failed attempts. Please request a new code." };
  }

  entry.attempts += 1;

  const entered = Buffer.from(codeInput.trim());
  const stored = Buffer.from(entry.code);

  if (entered.length !== stored.length || !timingSafeEqual(entered, stored)) {
    return { valid: false, reason: "Incorrect OTP code. Please check and try again." };
  }

  // Once successfully verified, remove it
  otpMap.delete(cleanEmail);
  return { valid: true };
}
