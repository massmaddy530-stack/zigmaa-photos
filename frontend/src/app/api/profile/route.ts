import { NextRequest, NextResponse } from "next/server";
import { checkCredentials, hashPassword, saveDynamicPasswordHash } from "@/lib/auth/password";
import { verifySessionToken } from "@/lib/auth/session";
import { findUserByEmail, updateUserPassword, updateUserProfile } from "@/lib/auth/user-store";
import { authConfig, cookieSecure, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/server-config";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const config = authConfig();
    if (!token || !config || !(await verifySessionToken(token, config, SESSION_MAX_AGE_S))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const profile = {
      name: "Studio Admin",
      email: "massmaddy530@gmail.com",
      picture: "",
      provider: "password" as "google" | "password",
    };

    const raw = req.cookies.get("evp_profile")?.value;
    if (raw) {
      try {
        const parsed = JSON.parse(decodeURIComponent(raw));
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.email === "string" && parsed.email) profile.email = parsed.email;
          if (typeof parsed.name === "string" && parsed.name) profile.name = parsed.name;
          if (typeof parsed.picture === "string") profile.picture = parsed.picture;
          if (parsed.provider === "google" || parsed.provider === "password") profile.provider = parsed.provider;
        }
      } catch {
        // ignore cookie parse error
      }
    }

    // Always fetch latest persisted name & avatar from store
    const storedUser = findUserByEmail(profile.email);
    if (storedUser) {
      if (storedUser.name) profile.name = storedUser.name;
      if (storedUser.picture) profile.picture = storedUser.picture;
    }

    return NextResponse.json({ ok: true, user: profile });
  } catch (err: unknown) {
    console.error("GET /api/profile error:", err);
    return NextResponse.json({ ok: false, error: "Failed to load profile." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const config = authConfig();
  if (!token || !config || !(await verifySessionToken(token, config, SESSION_MAX_AGE_S))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : undefined;
    const email = typeof body?.email === "string" ? body.email.trim() : undefined;
    const picture = typeof body?.picture === "string" ? body.picture : undefined;
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

    const currentProfile = {
      name: "Studio Admin",
      email: "massmaddy530@gmail.com",
      picture: "",
      provider: "password" as "google" | "password",
    };

    const raw = req.cookies.get("evp_profile")?.value;
    if (raw) {
      try {
        const parsed = JSON.parse(decodeURIComponent(raw));
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.email === "string" && parsed.email) currentProfile.email = parsed.email;
          if (typeof parsed.name === "string" && parsed.name) currentProfile.name = parsed.name;
          if (typeof parsed.picture === "string") currentProfile.picture = parsed.picture;
          if (parsed.provider === "google" || parsed.provider === "password") currentProfile.provider = parsed.provider;
        }
      } catch {
        // ignore
      }
    }

    // Check if password change is requested
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json(
          { ok: false, error: "Current password is required to set a new password." },
          { status: 400 }
        );
      }

      const validCurrent = await checkCredentials(currentProfile.email || config.username, currentPassword, config);
      if (!validCurrent) {
        return NextResponse.json(
          { ok: false, error: "Current password is incorrect." },
          { status: 400 }
        );
      }

      if (newPassword.length < 8) {
        return NextResponse.json(
          { ok: false, error: "New password must be at least 8 characters long." },
          { status: 400 }
        );
      }

      const newHash = await hashPassword(newPassword);
      process.env.ADMIN_PASSWORD_HASH = newHash;
      saveDynamicPasswordHash(newHash);
      if (currentProfile.email) {
        updateUserPassword(currentProfile.email, newHash);
      }

      // Update .env.local file
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
    }

    const updatedProfile = {
      ...currentProfile,
      name: name !== undefined ? name : currentProfile.name,
      email: email !== undefined ? email : currentProfile.email,
      picture: picture !== undefined ? picture : currentProfile.picture,
    };

    // Persist full profile with picture into user store
    if (currentProfile.email) {
      updateUserProfile(currentProfile.email, {
        name: updatedProfile.name,
        email: updatedProfile.email,
        picture: updatedProfile.picture,
      });
    }

    const res = NextResponse.json({
      ok: true,
      message: "Profile updated successfully.",
      user: updatedProfile,
    });

    // Keep cookie small: never put large base64 data URLs in Set-Cookie header
    const cookieSafeProfile = {
      name: updatedProfile.name,
      email: updatedProfile.email,
      picture: (updatedProfile.picture && updatedProfile.picture.startsWith("http") && updatedProfile.picture.length < 300)
        ? updatedProfile.picture
        : "",
      provider: updatedProfile.provider,
    };

    res.cookies.set("evp_profile", encodeURIComponent(JSON.stringify(cookieSafeProfile)), {
      httpOnly: false,
      sameSite: "lax",
      secure: cookieSecure(),
      path: "/",
      maxAge: SESSION_MAX_AGE_S,
    });

    return res;
  } catch (err: unknown) {
    console.error("Profile update error:", err);
    return NextResponse.json({ ok: false, error: "Failed to update profile." }, { status: 500 });
  }
}

