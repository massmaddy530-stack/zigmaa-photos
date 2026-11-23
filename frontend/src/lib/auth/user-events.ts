import { getPool } from "./db";
import { promises as fs } from "node:fs";
import path from "node:path";

interface UserEventRecord {
  user_email: string;
  event_id: string;
  role: string;
  created_at: number;
}

const LOCAL_FALLBACK_FILE = path.join(process.cwd(), "data", "user_events.json");

async function readLocalRecords(): Promise<UserEventRecord[]> {
  try {
    const raw = await fs.readFile(LOCAL_FALLBACK_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLocalRecords(records: UserEventRecord[]): Promise<void> {
  try {
    const dir = path.dirname(LOCAL_FALLBACK_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(LOCAL_FALLBACK_FILE, JSON.stringify(records, null, 2), "utf-8");
  } catch (err) {
    console.warn("Could not write local user_events fallback:", err);
  }
}

/** Record that a user created/owns an event */
export async function recordUserEvent(userEmail: string, eventId: string, role = "owner"): Promise<void> {
  const normEmail = userEmail.trim().toLowerCase();
  const cleanEventId = eventId.trim();
  if (!normEmail || !cleanEventId) return;

  const pool = getPool();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO public.user_events (user_email, event_id, role, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_email, event_id) DO NOTHING`,
        [normEmail, cleanEventId, role, Date.now()]
      );

      // Also set owner_email directly on public.events if column exists
      await pool.query(
        `UPDATE public.events SET owner_email = $1 WHERE id::text = $2`,
        [normEmail, cleanEventId]
      ).catch(() => undefined);
    } catch (err) {
      console.warn("PostgreSQL recordUserEvent failed (falling back to file):", err);
    }
  }

  // Also write to local fallback
  try {
    const local = await readLocalRecords();
    if (!local.some((r) => r.user_email === normEmail && r.event_id === cleanEventId)) {
      local.push({ user_email: normEmail, event_id: cleanEventId, role, created_at: Date.now() });
      await writeLocalRecords(local);
    }
  } catch {
    // Ignore local storage error
  }
}

/** Returns the set of event IDs accessible to this user */
export async function getUserEventIds(userEmail: string): Promise<Set<string>> {
  const normEmail = userEmail.trim().toLowerCase();
  const result = new Set<string>();
  if (!normEmail) return result;

  const pool = getPool();
  if (pool) {
    try {
      const res = await pool.query(
        `SELECT event_id FROM public.user_events WHERE LOWER(user_email) = $1
         UNION
         SELECT id::text as event_id FROM public.events WHERE LOWER(owner_email) = $1`,
        [normEmail]
      );
      for (const row of res.rows) {
        if (row.event_id) result.add(String(row.event_id));
      }
      return result;
    } catch (err) {
      console.warn("PostgreSQL getUserEventIds failed (falling back to file):", err);
    }
  }

  // Fallback to local file
  const local = await readLocalRecords();
  for (const r of local) {
    if (r.user_email.toLowerCase() === normEmail) {
      result.add(r.event_id);
    }
  }
  return result;
}
