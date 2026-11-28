import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/auth/db";
import { hasCsrfHeader } from "@/lib/auth/request";
import { verifyMiddlewareSession, verifySessionToken } from "@/lib/auth/session";
import { authConfig, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/server-config";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface CameraSettingsPayload {
  cloudOnlyMode: boolean;
  allowGuestBrowseAll?: boolean;
  ftpEnabled: boolean;
  ftpHost: string;
  ftpPort: number;
  ftpPassiveMode: boolean;
  ftpUsername: string;
  ftpPassword: string;
  targetEventId: string;
  cameraModel: string;
  updatedAt?: number;
}

const DEFAULT_SETTINGS: CameraSettingsPayload = {
  cloudOnlyMode: false,
  allowGuestBrowseAll: true,
  ftpEnabled: true,
  ftpHost: "ftp.zigmaamoments.com",
  ftpPort: 2121,
  ftpPassiveMode: true,
  ftpUsername: "",
  ftpPassword: "",
  targetEventId: "",
  cameraModel: "Canon EOS R",
};

const memoryStore = new Map<string, CameraSettingsPayload>();

let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.camera_settings (
        user_key text PRIMARY KEY,
        config_json text NOT NULL,
        updated_at bigint NOT NULL
      )
    `);
    tableEnsured = true;
  } catch (err) {
    console.warn("Could not ensure camera_settings table:", err);
  }
}

async function resolveAuthenticatedUser(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const config = authConfig();
  if (!token || !config) return null;

  const payload = await verifySessionToken(token, config, SESSION_MAX_AGE_S);
  if (payload?.sub) return payload.sub.trim().toLowerCase();

  const midValid = await verifyMiddlewareSession(token, config.sessionSecret, SESSION_MAX_AGE_S);
  if (!midValid) return null;

  const rawProfile = req.cookies.get("evp_profile")?.value;
  if (rawProfile) {
    try {
      const parsed = JSON.parse(decodeURIComponent(rawProfile));
      if (typeof parsed?.email === "string" && parsed.email.includes("@")) {
        return parsed.email.trim().toLowerCase();
      }
    } catch {
      /* ignore */
    }
  }
  return config.username.toLowerCase();
}

export async function GET(req: NextRequest) {
  const userKey = await resolveAuthenticatedUser(req);
  if (!userKey) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const mem = memoryStore.get(userKey);
  if (mem) {
    return NextResponse.json({ ok: true, settings: { ...DEFAULT_SETTINGS, ...mem } });
  }

  const pool = getPool();
  if (pool) {
    try {
      await ensureTable();
      const res = await pool.query(
        `SELECT config_json FROM public.camera_settings WHERE user_key = $1 LIMIT 1`,
        [userKey],
      );
      if (res.rows.length > 0 && res.rows[0].config_json) {
        const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(res.rows[0].config_json) };
        memoryStore.set(userKey, parsed);
        return NextResponse.json({ ok: true, settings: parsed });
      }
    } catch (err) {
      console.warn("Failed to read camera_settings from DB:", err);
    }
  }

  try {
    const filePath = path.join(tmpdir(), `zigmaa_cam_${userKey.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(content) };
    memoryStore.set(userKey, parsed);
    return NextResponse.json({ ok: true, settings: parsed });
  } catch {
    /* not on disk */
  }

  return NextResponse.json({ ok: true, settings: DEFAULT_SETTINGS });
}

export async function POST(req: NextRequest) {
  const userKey = await resolveAuthenticatedUser(req);
  if (!userKey) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!hasCsrfHeader(req)) {
    return NextResponse.json({ ok: false, error: "csrf" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const sanitized: CameraSettingsPayload = {
    cloudOnlyMode: Boolean(body.cloudOnlyMode),
    ftpEnabled: body.ftpEnabled !== false,
    ftpHost: typeof body.ftpHost === "string" && body.ftpHost.trim() ? body.ftpHost.trim().slice(0, 120) : DEFAULT_SETTINGS.ftpHost,
    ftpPort: Number.isInteger(Number(body.ftpPort)) && Number(body.ftpPort) >= 1 && Number(body.ftpPort) <= 65535
      ? Number(body.ftpPort)
      : 2121,
    ftpPassiveMode: body.ftpPassiveMode !== false,
    ftpUsername: typeof body.ftpUsername === "string" ? body.ftpUsername.trim().slice(0, 80) : "",
    ftpPassword: typeof body.ftpPassword === "string" ? body.ftpPassword.slice(0, 120) : "",
    targetEventId: typeof body.targetEventId === "string" ? body.targetEventId.trim().slice(0, 80) : "",
    cameraModel: typeof body.cameraModel === "string" && body.cameraModel.trim() ? body.cameraModel.trim().slice(0, 60) : "Canon EOS R",
    updatedAt: Date.now(),
  };

  memoryStore.set(userKey, sanitized);
  const configJson = JSON.stringify(sanitized);

  const pool = getPool();
  if (pool) {
    try {
      await ensureTable();
      await pool.query(
        `INSERT INTO public.camera_settings (user_key, config_json, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_key) DO UPDATE
         SET config_json = EXCLUDED.config_json, updated_at = EXCLUDED.updated_at`,
        [userKey, configJson, sanitized.updatedAt],
      );
    } catch (err) {
      console.warn("Failed to save camera_settings to DB:", err);
    }
  }

  try {
    const filePath = path.join(tmpdir(), `zigmaa_cam_${userKey.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
    await fs.writeFile(filePath, configJson, "utf-8");
  } catch {
    /* ignore */
  }

  return NextResponse.json({ ok: true, settings: sanitized });
}
