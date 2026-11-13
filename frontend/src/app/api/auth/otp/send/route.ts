import { NextRequest, NextResponse } from "next/server";
import { generateOtp } from "@/lib/auth/otp-store";
import { sendOtpEmail } from "@/lib/email/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json(
        { ok: false, error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    // Generate cryptographic 6-digit OTP
    const otp = generateOtp(email);

    // Send via verified SMTP
    await sendOtpEmail(email, otp);

    return NextResponse.json({
      ok: true,
      message: `A 6-digit verification code has been sent to ${email}`,
    });
  } catch (err: unknown) {
    console.error("Failed to send OTP email:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to send OTP email. Please ensure SMTP credentials are valid and try again.",
      },
      { status: 500 }
    );
  }
}
