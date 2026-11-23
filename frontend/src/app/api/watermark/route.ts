import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/auth/db";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-memory cache for ultra-fast lookup across hot serverless lambdas
const memoryCache = new Map<string, { config: unknown; updatedAt: number }>();

let tableEnsured = false;
async function ensureWatermarkTable() {
  if (tableEnsured) return;
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.event_watermarks (
        key text PRIMARY KEY,
        event_id text,
        slug text,
        config_json text NOT NULL,
        updated_at bigint NOT NULL
      )
    `);
    tableEnsured = true;
  } catch (err) {
    console.warn("Could not ensure event_watermarks table:", err);
  }
}

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const slug = searchParams.get("slug")?.trim();
  const eventId = searchParams.get("eventId")?.trim();
  const key = slug || eventId;

  if (!key) {
    return NextResponse.json({ ok: false, error: "missing_key" }, { status: 400 });
  }

  // 1. Check in-memory cache
  const cached = memoryCache.get(key);
  if (cached) {
    return NextResponse.json({ ok: true, config: cached.config, source: "memory" });
  }

  // 2. Check PostgreSQL database
  const pool = getPool();
  if (pool) {
    try {
      await ensureWatermarkTable();
      const res = await pool.query(
        `SELECT config_json FROM public.event_watermarks WHERE key = $1 OR slug = $1 OR event_id = $1 LIMIT 1`,
        [key]
      );
      if (res.rows.length > 0 && res.rows[0].config_json) {
        const parsed = JSON.parse(res.rows[0].config_json);
        memoryCache.set(key, { config: parsed, updatedAt: Date.now() });
        return NextResponse.json({ ok: true, config: parsed, source: "db" });
      }
    } catch (err) {
      console.warn("Database watermark fetch error:", err);
    }
  }

  // 3. Check filesystem cache
  try {
    const filePath = path.join(tmpdir(), `zigmaa_wm_${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    memoryCache.set(key, { config: parsed, updatedAt: Date.now() });
    return NextResponse.json({ ok: true, config: parsed, source: "fs" });
  } catch {
    /* not on disk */
  }

  return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventId = body.eventId?.toString().trim();
    const slug = body.slug?.toString().trim();
    const config = body.config;

    if (!config || (!eventId && !slug)) {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const configJson = JSON.stringify(config);
    const now = Date.now();

    // 1. Update memory cache
    if (eventId) memoryCache.set(eventId, { config, updatedAt: now });
    if (slug) memoryCache.set(slug, { config, updatedAt: now });

    // 2. Persist to PostgreSQL if configured
    const pool = getPool();
    if (pool) {
      try {
        await ensureWatermarkTable();
        const keysToSet = [eventId, slug].filter(Boolean) as string[];
        for (const k of keysToSet) {
          await pool.query(
            `INSERT INTO public.event_watermarks (key, event_id, slug, config_json, updated_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (key) DO UPDATE SET
               config_json = EXCLUDED.config_json,
               updated_at = EXCLUDED.updated_at,
               event_id = EXCLUDED.event_id,
               slug = EXCLUDED.slug`,
            [k, eventId || null, slug || null, configJson, now]
          );
        }
      } catch (err) {
        console.warn("Could not save watermark to PostgreSQL:", err);
      }
    }

    // 3. Write to temporary filesystem
    try {
      const keysToSet = [eventId, slug].filter(Boolean) as string[];
      for (const k of keysToSet) {
        const filePath = path.join(tmpdir(), `zigmaa_wm_${k.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
        await fs.writeFile(filePath, configJson, "utf-8");
      }
    } catch {
      /* ignore file write error */
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Watermark POST handler error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
