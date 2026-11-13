import { NextRequest, NextResponse } from "next/server";
import { verifyOtp } from "@/lib/auth/otp-store";
import { hashPassword } from "@/lib/auth/password";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const otp = typeof body?.otp === "string" ? body.otp.trim() : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

    if (!email || !otp) {
      return NextResponse.json(
        { ok: false, error: "Email and OTP code are required." },
        { status: 400 }
      );
    }

    const verification = verifyOtp(email, otp);
    if (!verification.valid) {
      return NextResponse.json(
        { ok: false, error: verification.reason || "Invalid verification code." },
        { status: 400 }
      );
    }

    if (newPassword) {
      if (newPassword.length < 8) {
        return NextResponse.json(
          { ok: false, error: "Password must be at least 8 characters long." },
          { status: 400 }
        );
      }

      // Hash new password using scrypt
      const newHash = await hashPassword(newPassword);
      process.env.ADMIN_PASSWORD_HASH = newHash;

      // Update .env.local file so it persists across restarts
      try {
        const envPath = path.join(process.cwd(), ".env.local");
        let content = await fs.readFile(envPath, "utf-8").catch(() => "");
        if (content.includes("ADMIN_PASSWORD_HASH=")) {
          content = content.replace(/ADMIN_PASSWORD_HASH="?[^"\n]+"?/, `ADMIN_PASSWORD_HASH="${newHash}"`);
          await fs.writeFile(envPath, content, "utf-8");
        }
      } catch (err) {
        console.warn("Could not write updated hash to .env.local:", err);
      }

      return NextResponse.json({
        ok: true,
        message: "Your password has been reset successfully. You can now log in.",
      });
    }

    return NextResponse.json({
      ok: true,
      message: "OTP verified successfully.",
    });
  } catch (err: unknown) {
    console.error("OTP verification error:", err);
    return NextResponse.json(
      { ok: false, error: "An error occurred during verification." },
      { status: 500 }
    );
  }
}
