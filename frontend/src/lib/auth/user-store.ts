import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

// Default pre-seeded admin accounts
const SEED_USERS: StoredUser[] = [
  {
    id: "admin-seed-1",
    email: "massmaddy530@gmail.com",
    name: "Mass Maddy (Studio Admin)",
    passwordHash: "scrypt$16384$8$5$WHyZeot7L8+sJHzOxUuu4w==$O44VqRiQDMR/jO/74TIFjkQybd14EMvLhGkMA8VJFmc=", // Maddy@2002
    role: "admin",
    createdAt: 1700000000000,
  },
  {
    id: "admin-seed-2",
    email: "madhavansep28@gmail.com",
    name: "Madhavan R (Studio Admin)",
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

export function isEmailRegistered(email: string): boolean {
  const norm = email.trim().toLowerCase();
  // Check admin seeds
  if (norm === "admin") return true;
  if (norm === "massmaddy530@gmail.com" || norm === "madhavansep28@gmail.com" || norm === "zigmaatech@gmail.com") return true;
  const envEmails = (process.env.ADMIN_GOOGLE_EMAILS || "")
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
}

export function updateUserPassword(email: string, newPasswordHash: string): boolean {
  const map = initMemoryMap();
  const norm = email.trim().toLowerCase();
  const user = map.get(norm);
  if (user) {
    user.passwordHash = newPasswordHash;
    map.set(norm, user);
    persistToFile(map);
    return true;
  }
  return false;
}

export function updateUserProfile(email: string, updates: Partial<StoredUser>): boolean {
  const map = initMemoryMap();
  const norm = email.trim().toLowerCase();
  const user = map.get(norm);
  if (user) {
    Object.assign(user, updates);
    map.set(norm, user);
    persistToFile(map);
    return true;
  }
  return false;
}
