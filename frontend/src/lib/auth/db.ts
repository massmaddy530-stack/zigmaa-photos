// Server-side PostgreSQL connection pool for Supabase / remote databases.
// Used by user-store to persist users and password updates across Vercel serverless containers.
import { Pool } from "pg";
import type { StoredUser } from "./user-store";

let poolInstance: Pool | null = null;

function getDbUrl(): string | null {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return null;
  }
  const url =
    process.env.DATABASE_URL?.trim() ||
    process.env.SUPABASE_DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    "";
  const clean = url.replace(/^["']|["']$/g, "");
  // Replace postgresql+asyncpg:// with postgresql:// if passed from Python backend env
  if (clean.startsWith("postgresql+asyncpg://")) {
    return clean.replace("postgresql+asyncpg://", "postgresql://");
  }
  return clean.startsWith("postgres://") || clean.startsWith("postgresql://") ? clean : null;
}

export function getPool(): Pool | null {
  if (poolInstance) return poolInstance;
  const connectionString = getDbUrl();
  if (!connectionString) return null;

  try {
    const isLocalDb =
      connectionString.includes("127.0.0.1") || connectionString.includes("localhost");
    poolInstance = new Pool({
      connectionString,
      ssl: isLocalDb ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    poolInstance.on("error", (err) => {
      console.warn("PostgreSQL pool error:", err.message);
    });

    return poolInstance;
  } catch (err) {
    console.warn("Failed to initialize PostgreSQL pool:", err);
    return null;
  }
}

export async function queryUsersFromDb(): Promise<StoredUser[] | null> {
  const pool = getPool();
  if (!pool) return null;

  try {
    const res = await pool.query(
      `SELECT id, email, password_hash, name, company, contact, picture, role, created_at 
       FROM public.users`
    );
    return res.rows.map((r) => ({
      id: r.id,
      email: r.email.toLowerCase(),
      passwordHash: r.password_hash,
      name: r.name,
      company: r.company || undefined,
      contact: r.contact || undefined,
      picture: r.picture || "",
      role: r.role === "admin" ? "admin" : "user",
      createdAt: Number(r.created_at) || Date.now(),
    }));
  } catch (err) {
    console.warn("queryUsersFromDb failed (falling back to memory):", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function findUserInDb(email: string): Promise<StoredUser | null> {
  const pool = getPool();
  if (!pool) return null;

  try {
    const norm = email.trim().toLowerCase();
    const res = await pool.query(
      `SELECT id, email, password_hash, name, company, contact, picture, role, created_at 
       FROM public.users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [norm]
    );
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      email: r.email.toLowerCase(),
      passwordHash: r.password_hash,
      name: r.name,
      company: r.company || undefined,
      contact: r.contact || undefined,
      picture: r.picture || "",
      role: r.role === "admin" ? "admin" : "user",
      createdAt: Number(r.created_at) || Date.now(),
    };
  } catch (err) {
    console.warn("findUserInDb failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function saveUserToDb(user: StoredUser): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;

  try {
    await pool.query(
      `INSERT INTO public.users (id, email, password_hash, name, company, contact, picture, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         name = EXCLUDED.name,
         company = EXCLUDED.company,
         contact = EXCLUDED.contact,
         picture = EXCLUDED.picture,
         role = EXCLUDED.role`,
      [
        user.id,
        user.email.toLowerCase(),
        user.passwordHash,
        user.name,
        user.company || null,
        user.contact || null,
        user.picture || null,
        user.role,
        user.createdAt,
      ]
    );
    return true;
  } catch (err) {
    console.warn("saveUserToDb failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function updateUserPasswordInDb(email: string, newPasswordHash: string): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;

  try {
    const norm = email.trim().toLowerCase();
    const res = await pool.query(
      `UPDATE public.users SET password_hash = $1 WHERE LOWER(email) = LOWER($2)`,
      [newPasswordHash, norm]
    );
    if (res.rowCount && res.rowCount > 0) return true;

    // If user does not exist yet in DB, create record
    await pool.query(
      `INSERT INTO public.users (id, email, password_hash, name, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [
        `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        norm,
        newPasswordHash,
        norm.includes("@") ? norm.split("@")[0] : "Studio Administrator",
        "admin",
        Date.now(),
      ]
    );
    return true;
  } catch (err) {
    console.warn("updateUserPasswordInDb failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function updateUserProfileInDb(email: string, updates: Partial<StoredUser>): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;

  try {
    const norm = email.trim().toLowerCase();
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(updates.name);
    }
    if (updates.picture !== undefined) {
      fields.push(`picture = $${idx++}`);
      values.push(updates.picture);
    }
    if (updates.company !== undefined) {
      fields.push(`company = $${idx++}`);
      values.push(updates.company);
    }
    if (updates.contact !== undefined) {
      fields.push(`contact = $${idx++}`);
      values.push(updates.contact);
    }

    if (!fields.length) return true;

    values.push(norm);
    await pool.query(
      `UPDATE public.users SET ${fields.join(", ")} WHERE LOWER(email) = LOWER($${idx})`,
      values
    );
    return true;
  } catch (err) {
    console.warn("updateUserProfileInDb failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
