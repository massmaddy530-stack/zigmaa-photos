import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { createSessionToken } from "@/lib/auth/session";
import { isEmailRegistered, saveUser, type StoredUser } from "@/lib/auth/user-store";
import { authConfig, cookieSecure, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";
    const companyName = typeof body?.companyName === "string" ? body.companyName.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const contactNumber = typeof body?.contactNumber === "string" ? body.contactNumber.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    // Validation
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json(
        { ok: false, error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    if (!password || password.length < 8) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 8 characters long." },
        { status: 400 }
      );
    }

    // Check if account already exists
    if (isEmailRegistered(email)) {
      return NextResponse.json(
        { ok: false, error: "An account with this email address already exists. Please sign in." },
        { status: 409 }
      );
    }

    // Hash password with scrypt
    const passwordHash = await hashPassword(password);

    const newUser: StoredUser = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email,
      passwordHash,
      name: `${firstName} ${lastName}`.trim() || email.split("@")[0],
      company: companyName || undefined,
      contact: contactNumber || undefined,
      role: "user",
      createdAt: Date.now(),
    };

    saveUser(newUser);

    const res = NextResponse.json(
      { ok: true, message: "Account created successfully!" },
      { status: 201 }
    );

    // Sign them in immediately with a session token
    const auth = authConfig();
    if (auth) {
      res.cookies.set(SESSION_COOKIE, await createSessionToken(auth, SESSION_MAX_AGE_S), {
        httpOnly: true,
        sameSite: "strict",
        secure: cookieSecure(),
        path: "/",
        maxAge: SESSION_MAX_AGE_S,
      });
    }

    const profile = {
      name: newUser.name,
      email: newUser.email,
      picture: "",
      provider: "password",
    };
    res.cookies.set("evp_profile", encodeURIComponent(JSON.stringify(profile)), {
      httpOnly: false,
      sameSite: "lax",
      secure: cookieSecure(),
      path: "/",
      maxAge: SESSION_MAX_AGE_S,
    });

    return res;
  } catch (err: unknown) {
    console.error("Sign up error:", err);
    return NextResponse.json(
      { ok: false, error: "An error occurred during account creation. Please try again." },
      { status: 500 }
    );
  }
}
