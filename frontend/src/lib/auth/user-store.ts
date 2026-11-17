import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initialUsersJson from "../../../data/users.json";
import { findUserInDb, saveUserToDb, updateUserPasswordInDb, updateUserProfileInDb } from "./db";

export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  company?: string;
  contact?: string;
  picture?: string;
  role: "admin" | "user";
  createdAt: number;
}

const DATA_DIR = join(process.cwd(), "data");
const USERS_FILE = join(DATA_DIR, "users.json");
const TMP_USERS_FILE = join(tmpdir(), "zigmaa_users.json");

// Default pre-seeded admin accounts (always present even in ephemeral serverless environments like Vercel)
const SEED_USERS: StoredUser[] = [
  {
    id: "admin-seed-1",
    email: "massmaddy530@gmail.com",
    name: "Mass Maddy",
    passwordHash: "scrypt$16384$8$5$WHyZeot7L8+sJHzOxUuu4w==$O44VqRiQDMR/jO/74TIFjkQybd14EMvLhGkMA8VJFmc=", // Maddy@2002
    role: "admin",
    createdAt: 1700000000000,
  },
  {
    id: "admin-seed-2",
    email: "madhavansep28@gmail.com",
    name: "Madhavan R",
    passwordHash: "scrypt$16384$8$5$3lDOiyOND/ViqEfjFqZchw==$+2i86f3jGATMexT03gB5QPp68Zjceb7w4QxlI1O125c=", // Admin12345678!
    role: "admin",
    createdAt: 1700000000000,
  },
  {
    id: "admin-seed-3",
    email: "zigmaatech@gmail.com",
    name: "Zigmaa Tech",
    passwordHash: "scrypt$16384$8$5$3lDOiyOND/ViqEfjFqZchw==$+2i86f3jGATMexT03gB5QPp68Zjceb7w4QxlI1O125c=", // Admin12345678!
    role: "admin",
    createdAt: 1700000000000,
  },
  {
    id: "admin-seed-4",
    email: "admin",
    name: "Studio Administrator",
    passwordHash: "scrypt$16384$8$5$3lDOiyOND/ViqEfjFqZchw==$+2i86f3jGATMexT03gB5QPp68Zjceb7w4QxlI1O125c=", // Admin12345678!
    role: "admin",
    createdAt: 1700000000000,
  },
  {
    id: "admin-seed-thoufiq",
    email: "mdthoufiq0507@gmail.com",
    name: "Mohamed Thoufiq",
    passwordHash: "scrypt$16384$8$5$3LQhimP+G1Tm4cT+g2bx8A==$VcxpLppdg2eygm6jOvqFvCp/LtjzvY7k3zsBUWQwhuY=",
    role: "admin",
    createdAt: 1794633975994,
  },
  {
    id: "admin-seed-thoufiq-2",
    email: "thoufiqarsath84@gmail.com",
    name: "Arsath Thoufiq",
    passwordHash: "scrypt$16384$8$5$3LQhimP+G1Tm4cT+g2bx8A==$VcxpLppdg2eygm6jOvqFvCp/LtjzvY7k3zsBUWQwhuY=",
    role: "admin",
    createdAt: 1794633975994,
  },
  {
    id: "admin-seed-zigmaa-report",
    email: "zigmaatechreport@gmail.com",
    name: "Zigmaa Tech",
    passwordHash: "scrypt$16384$8$5$WHyZeot7L8+sJHzOxUuu4w==$O44VqRiQDMR/jO/74TIFjkQybd14EMvLhGkMA8VJFmc=",
    role: "admin",
    createdAt: 1794633975994,
  },
];

declare global {
  var __ZIGMAA_USERS_MAP: Map<string, StoredUser> | undefined;
}

function initMemoryMap(): Map<string, StoredUser> {
  if (globalThis.__ZIGMAA_USERS_MAP) {
    return globalThis.__ZIGMAA_USERS_MAP;
  }
  const map = new Map<string, StoredUser>();

  // Add seeds first
  for (const u of SEED_USERS) {
    map.set(u.email.toLowerCase(), { ...u });
  }

  // Load bundled users.json (works in serverless/Vercel)
  if (Array.isArray(initialUsersJson)) {
    for (const item of initialUsersJson) {
      if (item && typeof item.email === "string" && typeof item.passwordHash === "string") {
        map.set(item.email.toLowerCase(), item as StoredUser);
      }
    }
  }

  // Load from files if present
  for (const filePath of [USERS_FILE, TMP_USERS_FILE]) {
    try {
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, "utf-8");
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && typeof item.email === "string" && typeof item.passwordHash === "string") {
              map.set(item.email.toLowerCase(), item);
            }
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  globalThis.__ZIGMAA_USERS_MAP = map;
  return map;
}

function persistToFile(map: Map<string, StoredUser>): void {
  const users = Array.from(map.values());
  const json = JSON.stringify(users, null, 2);

  // Try local data dir
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(USERS_FILE, json, "utf-8");
  } catch {
    // fallback if read-only filesystem
  }

  // Try /tmp dir (works on Vercel lambda)
  try {
    writeFileSync(TMP_USERS_FILE, json, "utf-8");
  } catch {
    // ignore
  }
}

export function getAllUsers(): StoredUser[] {
  const map = initMemoryMap();
  return Array.from(map.values());
}

export function findUserByEmail(email: string): StoredUser | null {
  const map = initMemoryMap();
  const norm = email.trim().toLowerCase();
  return map.get(norm) ?? null;
}

export async function findUserAsync(email: string): Promise<StoredUser | null> {
  const norm = email.trim().toLowerCase();
  const map = initMemoryMap();
  const cached = map.get(norm);
  if (cached) return cached;

  const dbUser = await findUserInDb(norm);
  if (dbUser) {
    map.set(norm, dbUser);
    return dbUser;
  }
  return null;
}

const STUDIO_DEFAULT_EMAILS = new Set([
  "admin",
  "massmaddy530@gmail.com",
  "madhavansep28@gmail.com",
  "zigmaatech@gmail.com",
  "zigmaatechreport@gmail.com",
  "mdthoufiq0507@gmail.com",
  "thoufiqarsath84@gmail.com",
]);

export function isEmailRegistered(email: string): boolean {
  const norm = email.trim().toLowerCase();
  // Check admin seeds
  if (STUDIO_DEFAULT_EMAILS.has(norm)) return true;
  const envEmails = (process.env.ADMIN_GOOGLE_EMAILS || "")
    .replace(/^["']|["']$/g, "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (envEmails.includes(norm)) return true;

  const map = initMemoryMap();
  return map.has(norm);
}

export function saveUser(user: StoredUser): void {
  const map = initMemoryMap();
  map.set(user.email.toLowerCase(), user);
  persistToFile(map);
  void saveUserToDb(user).catch(() => {});
}

export function updateUserPassword(email: string, newPasswordHash: string): boolean {
  const map = initMemoryMap();
  const norm = email.trim().toLowerCase();
  let user = map.get(norm);
  if (user) {
    user.passwordHash = newPasswordHash;
  } else {
    user = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email: norm,
      passwordHash: newPasswordHash,
      name: norm.includes("@") ? norm.split("@")[0] : "Studio Administrator",
      role: "admin",
      createdAt: Date.now(),
    };
  }
  map.set(norm, user);
  persistToFile(map);
  void updateUserPasswordInDb(norm, newPasswordHash).catch(() => {});
  return true;
}

export function updateUserProfile(email: string, updates: Partial<StoredUser>): boolean {
  const map = initMemoryMap();
  const norm = email.trim().toLowerCase();
  let user = map.get(norm);
  if (!user) {
    user = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email: norm,
      passwordHash: "",
      name: updates.name || "Studio Admin",
      role: "admin",
      createdAt: Date.now(),
    };
  }

  // If email is changing, update the map key
  const newEmail = updates.email?.trim().toLowerCase();
  if (newEmail && newEmail !== norm) {
    map.delete(norm);
    user.email = newEmail;
  }

  Object.assign(user, updates);
  map.set(user.email.toLowerCase(), user);
  persistToFile(map);
  void updateUserProfileInDb(norm, updates).catch(() => {});
  return true;
}
