"use client";

import { Camera, ImageUp, RefreshCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { captureVideoFrame, ImageReadError, normalizeImage } from "@/lib/image";
import { cn } from "@/lib/format";
import { Button } from "./ui/button";
import { Alert } from "./ui/states";

type Mode = "choose" | "camera";

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera access was blocked. Allow camera access in your browser settings, or upload a photo instead.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found. Upload a photo instead.";
  if (name === "NotReadableError") return "Your camera is being used by another app. Close it and try again, or upload a photo.";
  return "The camera couldn't be started. Upload a photo instead.";
}

/**
 * Lets the user take a selfie with the camera (getUserMedia) or pick/upload a photo.
 * Emits a normalised JPEG Blob. Nothing is uploaded by this component.
 */
export function SelfieCapture({ onCapture, disabled, uploadLabel = "Upload a photo", cameraLabel = "Take a selfie" }: {
  onCapture: (blob: Blob) => void;
  disabled?: boolean;
  uploadLabel?: string;
  cameraLabel?: string;
}) {
  const [mode, setMode] = useState<Mode>("choose");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Detected after mount: navigator doesn't exist during server rendering (avoids hydration mismatch).
  // getUserMedia is only available in secure contexts (HTTPS or localhost).
  const [cameraSupported, setCameraSupported] = useState(false);
  useEffect(() => setCameraSupported(!!navigator.mediaDevices?.getUserMedia), []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (mode !== "camera") return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch (err) {
        if (!cancelled) {
          setError(cameraErrorMessage(err));
          setMode("choose");
        }
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [mode, facing, stop]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onCapture(await normalizeImage(file));
    } catch (err) {
      setError(err instanceof ImageReadError ? err.message : "That image couldn't be read. Try another photo.");
    } finally {
      setBusy(false);
    }
  }

  async function snap() {
    if (!videoRef.current) return;
    setBusy(true);
    try {
      const blob = await captureVideoFrame(videoRef.current);
      stop();
      setMode("choose");
      onCapture(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't capture the photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="warning">{error}</Alert>}

      {mode === "camera" ? (
        <div className="overflow-hidden rounded-3xl bg-zinc-950">
          <div className="relative mx-auto aspect-[3/4] max-h-[60dvh] w-full">
            <video ref={videoRef} playsInline muted autoPlay onLoadedData={() => setReady(true)}
                   className={cn("h-full w-full object-cover", facing === "user" && "-scale-x-100")} />
            {/* face guide */}
            <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
              <div className="h-[58%] w-[62%] rounded-[50%] border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            <p className="absolute inset-x-0 top-4 text-center text-sm font-medium text-white drop-shadow">
              {ready ? "Center your face in the oval" : "Starting camera…"}
            </p>
            <button onClick={() => { stop(); setMode("choose"); }} aria-label="Close camera"
                    className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-black/50 text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-3 p-4">
            <Button variant="ghost" className="text-white hover:bg-white/10 hover:text-white" icon={<RefreshCcw className="h-4 w-4" />}
                    onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} aria-label="Switch camera">
              <span className="hidden sm:inline">Flip</span>
            </Button>
            <button onClick={snap} disabled={!ready || busy} aria-label="Capture photo"
                    className="grid h-16 w-16 place-items-center rounded-full bg-white ring-4 ring-white/30 transition active:scale-95 disabled:opacity-50">
              <span className="h-12 w-12 rounded-full border-2 border-zinc-900/10 bg-white" />
            </button>
            <span className="w-[72px]" aria-hidden />
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {cameraSupported && (
            <Button size="lg" onClick={() => { setError(null); setMode("camera"); }} disabled={disabled || busy}
                    icon={<Camera className="h-5 w-5" />} className="h-14 rounded-2xl">
              {cameraLabel}
            </Button>
          )}
          <Button size="lg" variant={cameraSupported ? "outline" : "primary"} loading={busy} disabled={disabled}
                  onClick={() => fileRef.current?.click()} icon={<ImageUp className="h-5 w-5" />}
                  className={cn("h-14 rounded-2xl", !cameraSupported && "sm:col-span-2")}>
            {uploadLabel}
          </Button>
          {/* capture="user" opens the front camera directly on most phones, even without getUserMedia (e.g. non-HTTPS) */}
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1}
                 {...(!cameraSupported ? { capture: "user" as const } : {})}
                 onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      )}
    </div>
  );
}
