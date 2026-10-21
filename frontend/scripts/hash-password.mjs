#!/usr/bin/env node
// Prints an ADMIN_PASSWORD_HASH value for the frontend. The password is read without echo and is never printed.
//
//   node scripts/hash-password.mjs
//
// Run it in a real terminal (PowerShell, Windows Terminal, macOS/Linux shells). Git Bash's mintty is not a
// terminal to Node, so typed characters would be visible there. Piped input is accepted for automation.
import { randomBytes, scrypt } from "node:crypto";

// Must match SCRYPT_PARAMS in src/lib/auth/password.ts.
const N = 16384;
const r = 8;
const p = 5;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MIN_LENGTH = 12;
const MAX_LENGTH = 1024;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    let value = "";
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stderr.write("\n");
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = [...value].slice(0, -1).join("");
        else value += ch;
      }
    };
    stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    stdin.resume();
  });
}

async function readPiped() {
  process.stderr.write("Standard input is not a terminal; reading the password from it. If you are typing, it is visible.\n");
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.split(/\r?\n/)[0];
}

let password;
try {
  if (process.stdin.isTTY) {
    password = await readHidden("New admin password: ");
    if ((await readHidden("Repeat password: ")) !== password) fail("Passwords do not match.");
  } else {
    password = await readPiped();
  }
} catch {
  fail("Cancelled.");
}

if (password.length < MIN_LENGTH) fail(`Use at least ${MIN_LENGTH} characters.`);
if (password.length > MAX_LENGTH) fail(`Use at most ${MAX_LENGTH} characters.`);

const salt = randomBytes(SALT_LENGTH);
const hash = await new Promise((resolve, reject) => {
  scrypt(password.normalize("NFC"), salt, KEY_LENGTH, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
    err ? reject(err) : resolve(key),
  );
});
process.stdout.write(`scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}\n`);
