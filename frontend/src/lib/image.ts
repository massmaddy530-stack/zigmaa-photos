"use client";

export class ImageReadError extends Error {}

const MAX_SIDE = 1280;

function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageReadError("Could not encode image"))), "image/jpeg", quality),
  );
}

function fit(w: number, h: number, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/**
 * Re-encode a user-chosen image as a bounded JPEG: applies EXIF orientation, strips metadata
 * (including GPS), converts formats the browser can decode (e.g. HEIC on Safari) and shrinks the upload.
 */
export async function normalizeImage(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageReadError("This image format can't be read on this device. Please use a JPEG or PNG photo, or take a new one.");
  }
  try {
    const { w, h } = fit(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageReadError("Your browser could not process the image.");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await canvasToJpeg(canvas);
  } finally {
    bitmap.close();
  }
}

/**
 * Optimizes an image file for uploading through serverless/Vercel proxies:
 * If the file exceeds maxMb (e.g. 3.5 MB), resizes it down to maxSide (2560px) JPEG at 0.88 quality.
 * Files <= maxMb that are already JPEG, PNG or WebP are preserved bit-for-bit.
 */
export async function optimizePhotoForUpload(
  file: File,
  maxMb = 3.5,
  maxSide = 2560,
  quality = 0.88,
): Promise<File> {
  if (
    file.size <= maxMb * 1024 * 1024 &&
    (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp")
  ) {
    return file;
  }
  if (typeof window === "undefined" || !("createImageBitmap" in window)) {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob || blob.size >= file.size) return file;
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

/** Grab the current camera frame as a JPEG (un-mirrored, bounded size). */
export async function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
  const { w, h } = fit(video.videoWidth, video.videoHeight);
  if (!w || !h) throw new ImageReadError("The camera isn't ready yet.");
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageReadError("Your browser could not capture the photo.");
  ctx.drawImage(video, 0, 0, w, h);
  return canvasToJpeg(canvas);
}

export class DownloadError extends Error {
  constructor(message: string, public expired = false) {
    super(message);
  }
}

/**
 * Overlays the MADX transparent logo in the right side middle of the photo
 * before saving to the user's device.
 */
async function applyWatermark(blob: Blob): Promise<Blob> {
  if (typeof window === "undefined" || typeof document === "undefined") return blob;

  return new Promise((resolve) => {
    const photoImg = new Image();
    const objectUrl = URL.createObjectURL(blob);

    photoImg.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const canvas = document.createElement("canvas");
        const width = photoImg.naturalWidth || photoImg.width;
        const height = photoImg.naturalHeight || photoImg.height;
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(blob);
          return;
        }

        // Draw the full resolution original photo
        ctx.drawImage(photoImg, 0, 0, width, height);

        // Load the translucent uncropped MADX photography watermark (round logo on top of text)
        const logo = new Image();
        logo.crossOrigin = "anonymous";
        logo.onload = () => {
          try {
            // Watermark size: proportional to the photo (approx 18% to 22% width, min 160px, max 540px)
            const targetWidth = Math.max(160, Math.min(width * 0.20, 540));
            const aspect = (logo.naturalWidth || 736) / (logo.naturalHeight || 570);
            const targetHeight = targetWidth / aspect;

            // Position: right side, just below middle (between middle and bottom)
            const margin = Math.max(20, Math.round(width * 0.035));
            const x = width - targetWidth - margin;
            // 0.68 positions it below middle, not most bottom (middle of middle and bottom)
            const y = Math.round((height - targetHeight) * 0.68);

            ctx.save();
            ctx.drawImage(logo, x, y, targetWidth, targetHeight);
            ctx.restore();

            canvas.toBlob(
              (watermarkedBlob) => {
                resolve(watermarkedBlob || blob);
              },
              "image/jpeg",
              0.95
            );
          } catch {
            resolve(blob);
          }
        };

        logo.onerror = () => {
          resolve(blob);
        };

        logo.src = "/watermark.png";
      } catch {
        resolve(blob);
      }
    };

    photoImg.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(blob);
    };

    photoImg.src = objectUrl;
  });
}

/**
 * Download an event photo with the MADX transparent watermark embedded on the right side below middle.
 * Automatically proxies through /api/download if cross-origin storage (e.g. Cloudflare R2) restricts CORS,
 * guaranteeing watermark embedding and direct download to local storage.
 * Throws DownloadError when offline, when the link has expired, or when the transfer is interrupted.
 */
export async function downloadImage(url: string, filename: string) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new DownloadError("You're offline. Reconnect and tap Download again.");
  }

  let res: Response;
  try {
    res = await fetch(url, { mode: "cors" });
    if (!res.ok && res.status !== 403) {
      throw new Error(`Direct fetch status ${res.status}`);
    }
  } catch {
    // If CORS or direct fetch fails, fetch through our same-origin proxy route
    try {
      const proxyUrl = `/api/download?url=${encodeURIComponent(url)}`;
      res = await fetch(proxyUrl);
    } catch {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        throw new DownloadError("Your connection dropped. Reconnect and tap Download again.");
      }
      throw new DownloadError("Download failed. Please check your connection and tap Download again.");
    }
  }

  if (res.status === 403) throw new DownloadError("This download link has expired. Start a new search to refresh it.", true);
  if (!res.ok) throw new DownloadError(`Download failed (${res.status}). Please try again.`);

  try {
    const rawBlob = await res.blob();
    const finalBlob = await applyWatermark(rawBlob);
    const href = URL.createObjectURL(finalBlob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch {
    throw new DownloadError("The download was interrupted. Check your connection and tap Download again.");
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Same-origin path for a signed media link on the backend's loopback address (http://localhost:8000/media/...),
 * which other devices can't open; next.config.ts forwards /media/* to the backend. The query (exp, sig) is kept.
 * Anything else (Supabase/R2, LAN or public hosts, relative links, non-media paths) is returned unchanged.
 */
export function browserMediaUrl<T extends string | null | undefined>(url: T): T {
  if (!url) return url;
  try {
    const u = new URL(url);
    if ((u.protocol === "http:" || u.protocol === "https:") && LOOPBACK_HOSTS.has(u.hostname)
        && u.pathname.startsWith("/media/")) {
      return `${u.pathname}${u.search}` as T;
    }
  } catch {
    /* relative or unparseable: leave as is */
  }
  return url;
}

/** File extension of a (signed) URL's path, e.g. ".jpg" — used to name downloads of originals. */
export function urlExtension(url: string, fallback = ".jpg"): string {
  try {
    // The base only applies to relative links (same-origin /media/...); absolute URLs ignore it.
    const base = typeof window !== "undefined" ? window.location.href : "http://localhost";
    const m = /\.(jpe?g|png|webp)$/i.exec(new URL(url, base).pathname);
    return m ? `.${m[1].toLowerCase()}` : fallback;
  } catch {
    return fallback;
  }
}
