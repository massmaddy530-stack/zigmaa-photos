// Public (browser-visible) configuration. Never put secrets in NEXT_PUBLIC_* variables.
// Empty = same origin as the page (requests are forwarded by the rewrites in next.config.ts); unset = localhost.
export const PUBLIC_API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

// Client-side pre-checks mirror backend limits (the backend remains the source of truth).
export const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || 40);
// image/mpo: camera multi-picture JPEGs. The backend detects the real format from file content either way.
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/mpo"];
// Used when the browser reports no MIME type (common for .mpo files).
export const ACCEPTED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".mpo"];
// Set NEXT_PUBLIC_SKIP_UPLOAD_COMPRESSION=true when hosted on a VPS (e.g. KVM2) without Vercel's 4.5 MB body limit.
export const SKIP_UPLOAD_COMPRESSION = process.env.NEXT_PUBLIC_SKIP_UPLOAD_COMPRESSION === "true";
export const UPLOAD_BATCH_FILES = 8;
export const UPLOAD_BATCH_BYTES = (SKIP_UPLOAD_COMPRESSION ? 35 : 4.0) * 1024 * 1024;
export const UPLOAD_CONCURRENCY = 5;
