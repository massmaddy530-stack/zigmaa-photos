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

export interface WatermarkConfig {
  imageUrl?: string | null;
  xPercent?: number; // 0 to 100
  yPercent?: number; // 0 to 100
  sizePercent?: number; // 5 to 60 (relative to photo width)
  opacity?: number; // 0.1 to 1.0
  color?: "original" | "white" | "gold" | "dark" | string;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export function saveEventWatermarkConfig(eventId: string, slug?: string | null, config?: WatermarkConfig) {
  if (typeof window === "undefined" || !config) return;
  try {
    const json = JSON.stringify(config);
    if (eventId) localStorage.setItem(`madx_event_watermark_${eventId}`, json);
    if (slug) localStorage.setItem(`madx_event_watermark_${slug}`, json);
    localStorage.setItem("madx_default_watermark", json);
  } catch (e) {
    console.warn("Could not save watermark config", e);
  }
}

export function getSavedWatermarkConfig(eventIdOrSlug?: string): WatermarkConfig | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    if (eventIdOrSlug) {
      const saved = localStorage.getItem(`madx_event_watermark_${eventIdOrSlug}`);
      if (saved) return JSON.parse(saved);
    }
    // Also check current URL path to auto-detect event id or slug
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts[0] === "e" && pathParts[1]) {
      const saved = localStorage.getItem(`madx_event_watermark_${pathParts[1]}`);
      if (saved) return JSON.parse(saved);
    } else if (pathParts[0] === "dashboard" && pathParts[1] === "events" && pathParts[2]) {
      const saved = localStorage.getItem(`madx_event_watermark_${pathParts[2]}`);
      if (saved) return JSON.parse(saved);
    }
    const defaultSaved = localStorage.getItem("madx_default_watermark");
    if (defaultSaved) return JSON.parse(defaultSaved);
  } catch {
    /* fallback to default */
  }
  return undefined;
}

/**
 * Overlays the watermark (custom uploaded or default MADX logo) on the photo
 * before saving to the user's device with exact placement, scale, opacity, and color.
 */
export async function applyWatermark(blob: Blob, customConfig?: WatermarkConfig): Promise<Blob> {
  if (typeof window === "undefined" || typeof document === "undefined") return blob;

  const config = customConfig || getSavedWatermarkConfig();

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

        // Load the watermark logo / template
        const logo = new Image();
        logo.crossOrigin = "anonymous";
        logo.onload = () => {
          try {
            // Sizing: based on configured percentage (default ~14% of photo width)
            const sizePct = config?.sizePercent ?? 14;
            const targetWidth = Math.max(60, Math.round(width * (sizePct / 100)));
            const aspect = (logo.naturalWidth || 736) / (logo.naturalHeight || 570);
            const targetHeight = Math.max(20, Math.round(targetWidth / aspect));

            // Position calculation
            const xPct = config?.xPercent ?? 88;
            const yPct = config?.yPercent ?? 88;

            // Mathematical match with preview (0% = left edge, 100% = right edge, 50% = center)
            let x = Math.round((width - targetWidth) * (Math.max(0, Math.min(100, xPct)) / 100));
            let y = Math.round((height - targetHeight) * (Math.max(0, Math.min(100, yPct)) / 100));

            // Bound checks
            x = Math.max(0, Math.min(x, width - targetWidth));
            y = Math.max(0, Math.min(y, height - targetHeight));

            ctx.save();
            ctx.globalAlpha = config?.opacity ?? 0.40;

            const color = config?.color || "original";
            if (color !== "original") {
              // Tint watermark using an offscreen canvas with source-in blend mode
              const offCanvas = document.createElement("canvas");
              offCanvas.width = targetWidth;
              offCanvas.height = targetHeight;
              const offCtx = offCanvas.getContext("2d");
              if (offCtx) {
                offCtx.drawImage(logo, 0, 0, targetWidth, targetHeight);
                let fillColor = color;
                if (color === "white") fillColor = "#ffffff";
                else if (color === "gold") fillColor = "#dfa843";
                else if (color === "dark") fillColor = "#140e07";

                offCtx.globalCompositeOperation = "source-in";
                offCtx.fillStyle = fillColor;
                offCtx.fillRect(0, 0, targetWidth, targetHeight);
                ctx.drawImage(offCanvas, x, y);
              } else {
                ctx.drawImage(logo, x, y, targetWidth, targetHeight);
              }
            } else {
              ctx.drawImage(logo, x, y, targetWidth, targetHeight);
            }

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

        logo.src = config?.imageUrl || "/watermark.png";
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
 * Download an event photo with the customized watermark embedded.
 * Automatically proxies through /api/download if cross-origin storage (e.g. Cloudflare R2) restricts CORS,
 * guaranteeing watermark embedding and direct download to local storage.
 * Throws DownloadError when offline, when the link has expired, or when the transfer is interrupted.
 */
export async function downloadImage(url: string, filename: string, config?: WatermarkConfig) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new DownloadError("You're offline. Reconnect and tap Download again.");
  }

  let res: Response;
  const isCrossOriginStorage =
    url.includes("r2.dev") ||
    url.includes("amazonaws.com") ||
    url.includes("cloudflarestorage.com") ||
    (typeof window !== "undefined" && !url.startsWith(window.location.origin) && !url.startsWith("/"));

  try {
    if (isCrossOriginStorage) {
      // Fetch directly through same-origin serverless download proxy to avoid CORS rejection
      const proxyUrl = `/api/download?url=${encodeURIComponent(url)}`;
      res = await fetch(proxyUrl);
    } else {
      res = await fetch(url, { mode: "cors" });
    }
    if (!res.ok && res.status !== 403) {
      throw new Error(`Fetch status ${res.status}`);
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
    const finalBlob = await applyWatermark(rawBlob, config);
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
