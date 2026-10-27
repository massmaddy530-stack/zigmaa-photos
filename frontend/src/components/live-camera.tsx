"use client";

import { Camera, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/format";
import { Button } from "./ui/button";

// ImageCapture (full-resolution stills from a camera track) is not in TypeScript's DOM types yet.
interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

/** Live camera needs a secure context (HTTPS or localhost) and getUserMedia. */
export function liveCameraSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

const MIN_SHOT_INTERVAL_MS = 350; // ignore accidental double taps
const JPEG_QUALITY = 0.92;

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
      return "Camera permission was denied. Allow camera access for this site in the browser settings, then tap Restart camera.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No suitable camera was found on this device.";
    case "NotReadableError":
      return "The camera is in use by another app. Close it, then tap Restart camera.";
    default:
      return "The camera could not be started.";
  }
}

function captureName(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `IMG_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${p(d.getMilliseconds(), 3)}.jpg`;
}

function frameToBlob(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx || !canvas.width) return Promise.reject(new Error("Camera frame not ready"));
  ctx.drawImage(video, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the photo"))), "image/jpeg", JPEG_QUALITY));
}

/**
 * In-page rear-camera viewfinder with a shutter button: each tap takes a still and hands it to `onCapture` at once,
 * without the native camera app's review screen. The viewfinder stays live; the caller saves and uploads the photo.
 */
export function LiveCamera({ onCapture, blocked, blockedLabel, onError }: {
  onCapture: (file: File) => void;
  /** Shutter disabled (e.g. too many photos still being saved). */
  blocked?: boolean;
  blockedLabel?: string;
  onError?: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imageCaptureRef = useRef<ImageCaptureLike | null>(null);
  const busyRef = useRef(false);
  const lastShotRef = useRef(0);
  const [state, setState] = useState<"starting" | "live" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [shots, setShots] = useState(0);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    imageCaptureRef.current = null;
  }, []);

  const start = useCallback(async () => {
    stop();
    setState("starting");
    setError(null);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 4096 }, height: { ideal: 3072 } },
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "OverconstrainedError") {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment" } });
        } else throw err;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      track.addEventListener("ended", () => {
        setState("error");
        setError("The camera stopped (the phone may have locked or another app took it). Tap Restart camera.");
      });
      const Ctor = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
      imageCaptureRef.current = Ctor ? new Ctor(track) : null;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setState("live");
    } catch (err) {
      const msg = cameraErrorMessage(err);
      setState("error");
      setError(msg);
      onError?.(msg);
    }
  }, [onError, stop]);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  async function shoot() {
    const now = Date.now();
    if (busyRef.current || blocked || state !== "live" || now - lastShotRef.current < MIN_SHOT_INTERVAL_MS) return;
    busyRef.current = true;
    lastShotRef.current = now;
    try {
      let blob: Blob | null = null;
      if (imageCaptureRef.current) {
        try {
          blob = await imageCaptureRef.current.takePhoto();
        } catch {
          blob = null; // some devices refuse takePhoto(); fall back to the video frame
        }
      }
      if (!blob && videoRef.current) blob = await frameToBlob(videoRef.current);
      if (!blob) throw new Error("No image from the camera");
      const type = blob.type === "image/png" || blob.type === "image/webp" ? blob.type : "image/jpeg";
      const name = captureName().replace(/\.jpg$/, type === "image/jpeg" ? ".jpg" : `.${type.slice(6)}`);
      onCapture(new File([blob], name, { type }));
      setShots((n) => n + 1);
      setFlash((n) => n + 1);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not take the photo");
    } finally {
      busyRef.current = false;
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-black sm:aspect-video sm:rounded-2xl">
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" aria-label="Camera viewfinder" />
        {flash > 0 && <div key={flash} className="pointer-events-none absolute inset-0 animate-[var(--animate-flash)] bg-white" aria-hidden />}
        {state === "starting" && <p className="absolute inset-0 grid place-items-center text-sm text-white/80">Starting camera…</p>}
        {state === "error" && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div>
              <p className="text-sm text-white">{error}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => void start()} icon={<RefreshCw className="h-4 w-4" />}>
                Restart camera
              </Button>
            </div>
          </div>
        )}
        {shots > 0 && (
          <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium tabular-nums text-white ring-1 ring-brand-300/40">
            {shots} taken
          </span>
        )}
      </div>
      <div className="flex flex-col items-center gap-2 px-4 sm:px-0">
        <button type="button" onClick={() => void shoot()} disabled={state !== "live" || blocked}
          aria-label="Take photo"
          className={cn("grid h-[84px] w-[84px] touch-manipulation place-items-center rounded-full bg-ink p-1.5 shadow-lg ring-2 ring-brand-400 transition-transform active:scale-95",
            "disabled:cursor-not-allowed disabled:opacity-50")}>
          <span className="grid h-full w-full place-items-center rounded-full bg-brand-400 ring-2 ring-inset ring-white/70">
            <Camera className="h-8 w-8 text-ink" aria-hidden />
          </span>
        </button>
        <p className="h-4 text-xs text-muted" aria-live="polite">{blocked ? blockedLabel ?? "Saving photos…" : state === "live" ? "Tap to take a photo" : ""}</p>
      </div>
    </div>
  );
}
