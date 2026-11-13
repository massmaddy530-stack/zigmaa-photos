import { NextRequest, NextResponse } from "next/server";
import { checkCredentials, hashPassword, saveDynamicPasswordHash } from "@/lib/auth/password";
import { verifySessionToken } from "@/lib/auth/session";
import { authConfig, cookieSecure, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/server-config";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const config = authConfig();
  if (!token || !config || !(await verifySessionToken(token, config, SESSION_MAX_AGE_S))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let profile = {
    name: "Studio Admin",
    email: "massmaddy530@gmail.com",
    picture: "",
    provider: "password",
  };

  const raw = req.cookies.get("evp_profile")?.value;
  if (raw) {
    try {
      profile = JSON.parse(decodeURIComponent(raw));
    } catch {
      // ignore
    }
  }

  return NextResponse.json({ ok: true, user: profile });
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

    let currentProfile = {
      name: "Studio Admin",
      email: "massmaddy530@gmail.com",
      picture: "",
      provider: "password",
    };

    const raw = req.cookies.get("evp_profile")?.value;
    if (raw) {
      try {
        currentProfile = JSON.parse(decodeURIComponent(raw));
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

      const validCurrent = await checkCredentials(config.username, currentPassword, config);
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

    const res = NextResponse.json({
      ok: true,
      message: "Profile updated successfully.",
      user: updatedProfile,
    });

    res.cookies.set("evp_profile", encodeURIComponent(JSON.stringify(updatedProfile)), {
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

