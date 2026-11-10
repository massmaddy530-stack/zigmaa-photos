// Public (browser-visible) configuration. Never put secrets in NEXT_PUBLIC_* variables.
// Empty = same origin as the page (requests are forwarded by the rewrites in next.config.ts); unset = localhost.
export const PUBLIC_API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

// Client-side pre-checks mirror backend limits (the backend remains the source of truth).
export const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || 40);
// image/mpo: camera multi-picture JPEGs. The backend detects the real format from file content either way.
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/mpo"];
// Used when the browser reports no MIME type (common for .mpo files).
export const ACCEPTED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".mpo"];
export const UPLOAD_BATCH_FILES = 3;
export const UPLOAD_BATCH_BYTES = 3.5 * 1024 * 1024;
export const UPLOAD_CONCURRENCY = 2;
