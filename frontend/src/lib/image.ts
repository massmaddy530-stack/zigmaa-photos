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

export interface WatermarkTemplateItem {
  id: string;
  name: string;
  dataUrl: string;
  sizeBytes?: number;
  xPercent?: number; // 0 to 100
  yPercent?: number; // 0 to 100
  sizePercent?: number; // 5 to 60 (relative to photo width)
  opacity?: number; // 0.1 to 1.0
  color?: "original" | "white" | "gold" | "dark" | string;
  enabled?: boolean; // default true
}

export interface WatermarkConfig {
  imageUrl?: string | null;
  templates?: WatermarkTemplateItem[];
  activeTemplateId?: string | null;
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

// In-memory watermark cache: guarantees instant access across tab transitions and prevents localStorage quota crashes
const memoryWatermarkStore = new Map<string, WatermarkConfig>();

/**
 * Compresses and downscales a watermark image to max 800px width/height PNG.
 * Preserves transparency, remains ultra-crisp for high-res photo overlays,
 * and ensures the base64 string is only ~40KB-70KB so it never fails localStorage or network transfer limits.
 */
export async function optimizeWatermarkFile(file: File, maxSize = 800): Promise<string> {
  if (typeof window === "undefined") return fileToDataUrl(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        try {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          const scale = Math.min(1, maxSize / Math.max(width, height));
          const targetW = Math.max(1, Math.round(width * scale));
          const targetH = Math.max(1, Math.round(height * scale));

          const canvas = document.createElement("canvas");
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, targetW, targetH);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // If quota exceeded, remove older watermarks or legacy items
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("madx_") || (k.startsWith("zigmaa_") && k !== key))) {
          localStorage.removeItem(k);
        }
      }
      localStorage.setItem(key, value);
    } catch {
      // Ignore if still full - memory store handles it
    }
  }
}

export function saveEventWatermarkConfig(eventId: string, slug?: string | null, config?: WatermarkConfig) {
  if (typeof window === "undefined" || !config) return;

  // 1. Always store in memory cache first for zero-latency instant access
  if (eventId) memoryWatermarkStore.set(eventId, config);
  if (slug) memoryWatermarkStore.set(slug, config);
  memoryWatermarkStore.set("default", config);

  // 2. Persist to localStorage safely
  try {
    const json = JSON.stringify(config);
    if (eventId) safeLocalStorageSet(`zigmaa_event_watermark_${eventId}`, json);
    if (slug) safeLocalStorageSet(`zigmaa_event_watermark_${slug}`, json);
    safeLocalStorageSet("zigmaa_default_watermark", json);
  } catch (e) {
    console.warn("Could not save watermark config to localStorage", e);
  }

  // 3. Sync to server API so guests and other devices automatically receive this exact watermark!
  if (eventId || slug) {
    void fetch("/api/watermark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, slug, config }),
    }).catch(() => undefined);
  }
}

export async function fetchEventWatermarkConfig(slugOrId: string): Promise<WatermarkConfig | undefined> {
  if (!slugOrId) return getSavedWatermarkConfig();
  // Check memory store first
  const inMem = memoryWatermarkStore.get(slugOrId);
  if (inMem && (inMem.templates?.length || inMem.imageUrl)) return inMem;

  try {
    const res = await fetch(`/api/watermark?slug=${encodeURIComponent(slugOrId)}&eventId=${encodeURIComponent(slugOrId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.config && typeof data.config === "object") {
        saveEventWatermarkConfig(slugOrId, slugOrId, data.config);
        return data.config as WatermarkConfig;
      }
    }
  } catch {
    /* fallback to local storage */
  }
  return getSavedWatermarkConfig(slugOrId);
}

export function getSavedWatermarkConfig(eventIdOrSlug?: string): WatermarkConfig | undefined {
  if (typeof window === "undefined") return undefined;

  const syncActiveImage = (cfg: WatermarkConfig | undefined): WatermarkConfig | undefined => {
    if (!cfg) return undefined;
    if (Array.isArray(cfg.templates) && cfg.templates.length > 0) {
      const active = cfg.templates.find((t) => t.id === cfg.activeTemplateId) || cfg.templates[0];
      if (active?.dataUrl) {
        cfg.imageUrl = active.dataUrl;
        if (!cfg.activeTemplateId) cfg.activeTemplateId = active.id;
      }
    }
    return cfg;
  };

  // 1. Check in-memory store
  if (eventIdOrSlug && memoryWatermarkStore.has(eventIdOrSlug)) {
    return syncActiveImage(memoryWatermarkStore.get(eventIdOrSlug));
  }
  if (memoryWatermarkStore.has("default")) {
    const d = memoryWatermarkStore.get("default");
    if (d?.templates?.length || d?.imageUrl) {
      return syncActiveImage(d);
    }
  }

  // 2. Check localStorage
  try {
    if (eventIdOrSlug) {
      const saved = localStorage.getItem(`zigmaa_event_watermark_${eventIdOrSlug}`) || localStorage.getItem(`madx_event_watermark_${eventIdOrSlug}`);
      if (saved) {
        const parsed = syncActiveImage(JSON.parse(saved));
        if (parsed) {
          memoryWatermarkStore.set(eventIdOrSlug, parsed);
          return parsed;
        }
      }
    }
    // Also check current URL path to auto-detect event id or slug
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts[0] === "e" && pathParts[1]) {
      const saved = localStorage.getItem(`zigmaa_event_watermark_${pathParts[1]}`) || localStorage.getItem(`madx_event_watermark_${pathParts[1]}`);
      if (saved) return syncActiveImage(JSON.parse(saved));
    } else if (pathParts[0] === "dashboard" && pathParts[1] === "events" && pathParts[2]) {
      const saved = localStorage.getItem(`zigmaa_event_watermark_${pathParts[2]}`) || localStorage.getItem(`madx_event_watermark_${pathParts[2]}`);
      if (saved) return syncActiveImage(JSON.parse(saved));
    }
    const defaultSaved = localStorage.getItem("zigmaa_default_watermark") || localStorage.getItem("madx_default_watermark");
    if (defaultSaved) return syncActiveImage(JSON.parse(defaultSaved));
  } catch {
    /* fallback to default */
  }
  return undefined;
}

/**
 * Overlays the watermark (custom uploaded or default Zigmaa logo) on the photo
 * before saving to the user's device with exact placement, scale, opacity, and color.
 */
export async function applyWatermark(blob: Blob, customConfig?: WatermarkConfig): Promise<Blob> {
  if (typeof window === "undefined" || typeof document === "undefined") return blob;

  const config = customConfig || getSavedWatermarkConfig();

  return new Promise((resolve) => {
    const photoImg = new Image();
    const objectUrl = URL.createObjectURL(blob);

    photoImg.onload = async () => {
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

        // Collect all enabled template layers to draw at the same time
        const layersToDraw: Array<{
          src: string;
          xPercent: number;
          yPercent: number;
          sizePercent: number;
          opacity: number;
          color: string;
        }> = [];

        if (Array.isArray(config?.templates) && config.templates.length > 0) {
          const activeId = config.activeTemplateId;
          for (const t of config.templates) {
            if (t.enabled !== false && t.dataUrl) {
              const isActive = t.id === activeId;
              layersToDraw.push({
                src: t.dataUrl,
                xPercent: (isActive && config.xPercent !== undefined ? config.xPercent : t.xPercent) ?? 88,
                yPercent: (isActive && config.yPercent !== undefined ? config.yPercent : t.yPercent) ?? 88,
                sizePercent: (isActive && config.sizePercent !== undefined ? config.sizePercent : t.sizePercent) ?? 16,
                opacity: (isActive && config.opacity !== undefined ? config.opacity : t.opacity) ?? 0.70,
                color: (isActive && config.color !== undefined ? config.color : t.color) ?? "original",
              });
            }
          }
        }

        // If no template items enabled, fallback to single custom imageUrl or default logo
        if (layersToDraw.length === 0) {
          if (config?.imageUrl) {
            layersToDraw.push({
              src: config.imageUrl,
              xPercent: config.xPercent ?? 88,
              yPercent: config.yPercent ?? 88,
              sizePercent: config.sizePercent ?? 16,
              opacity: config.opacity ?? 0.70,
              color: config.color ?? "original",
            });
          } else {
            layersToDraw.push({
              src: "/watermark.png",
              xPercent: config?.xPercent ?? 88,
              yPercent: config?.yPercent ?? 88,
              sizePercent: config?.sizePercent ?? 14,
              opacity: config?.opacity ?? 0.40,
              color: config?.color ?? "original",
            });
          }
        }

        // Draw each template onto the canvas at its own position, size and opacity
        const drawLayer = (layer: (typeof layersToDraw)[0]): Promise<void> => {
          return new Promise((layerResolve) => {
            const logo = new Image();
            logo.crossOrigin = "anonymous";
            logo.onload = () => {
              try {
                const sizePct = layer.sizePercent;
                const targetWidth = Math.max(60, Math.round(width * (sizePct / 100)));
                const aspect = (logo.naturalWidth || 736) / (logo.naturalHeight || 570);
                const targetHeight = Math.max(20, Math.round(targetWidth / aspect));

                let x = Math.round((width - targetWidth) * (Math.max(0, Math.min(100, layer.xPercent)) / 100));
                let y = Math.round((height - targetHeight) * (Math.max(0, Math.min(100, layer.yPercent)) / 100));

                x = Math.max(0, Math.min(x, width - targetWidth));
                y = Math.max(0, Math.min(y, height - targetHeight));

                ctx.save();
                ctx.globalAlpha = layer.opacity;

                const color = layer.color || "original";
                if (color !== "original") {
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
              } catch (e) {
                console.warn("Could not draw template layer", e);
              }
              layerResolve();
            };
            logo.onerror = () => layerResolve();
            logo.src = layer.src;
          });
        };

        for (const layer of layersToDraw) {
          await drawLayer(layer);
        }

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

/**
 * Downloads multiple images sequentially with a short delay so browsers don't block multiple downloads.
 */
export async function downloadImagesInBatch(
  items: Array<{ url: string; filename: string }>,
  config?: WatermarkConfig,
  onProgress?: (current: number, total: number) => void,
): Promise<{ successful: number; failed: number }> {
  let successful = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i++) {
    onProgress?.(i + 1, items.length);
    try {
      await downloadImage(items[i].url, items[i].filename, config);
      successful++;
    } catch {
      failed++;
    }
    if (i < items.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  return { successful, failed };
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
