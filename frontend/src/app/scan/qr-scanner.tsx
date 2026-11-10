"use client";

import { Camera, CameraOff, QrCode } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, Input } from "@/components/ui/primitives";
import { Alert } from "@/components/ui/states";
import { guestPathFromScan } from "@/lib/qr-target";

// The Barcode Detection API is not in TypeScript's DOM types yet (Chrome/Edge on Android and desktop support it).
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

async function qrDetector(): Promise<BarcodeDetectorLike | null> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor || !navigator.mediaDevices?.getUserMedia) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
    return formats.includes("qr_code") ? new Ctor({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

type CameraState = "checking" | "unsupported" | "idle" | "starting" | "scanning" | "denied" | "error";

/** Scan an event QR code in the browser, or type the code. Only this site's /e/<code> pages are opened. */
export function QrScanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const [camera, setCamera] = useState<CameraState>("checking");
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void qrDetector().then((d) => {
      if (cancelled) return;
      detectorRef.current = d;
      setCamera(d ? "idle" : "unsupported");
    });
    return () => { cancelled = true; stop(); };
  }, [stop]);

  const open = useCallback((raw: string): boolean => {
    const path = guestPathFromScan(raw);
    if (!path) return false;
    stop();
    router.push(path);
    return true;
  }, [router, stop]);

  async function start() {
    setProblem(null);
    setCamera("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCamera("scanning");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setCamera(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
    }
  }

  useEffect(() => {
    if (camera !== "scanning") return;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const tick = async () => {
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (!active || !video || !detector) return;
      if (video.readyState >= 2) {
        try {
          for (const b of await detector.detect(video)) {
            if (open(b.rawValue)) return;
            setProblem("That QR code isn't a MADX Photos event code. Scan the code from the event's table card or screen.");
          }
        } catch {
          // A frame can fail to decode; keep scanning.
        }
      }
      timer = setTimeout(() => void tick(), 250);
    };
    void tick();
    return () => { active = false; clearTimeout(timer); };
  }, [camera, open]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!open(code)) setProblem("Enter the event code or link exactly as shown under the QR code.");
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-md space-y-5 px-4 py-10">
        <div className="flex justify-center"><Logo /></div>
        <div className="text-center">
          <h1 className="text-xl font-semibold">Find your event</h1>
          <p className="mt-1 text-sm text-muted">Scan the QR code at the event, or type the code printed under it.</p>
        </div>

        <Card className="space-y-4 p-5">
          {camera === "scanning" || camera === "starting" ? (
            <div className="relative overflow-hidden rounded-2xl bg-black">
              <video ref={videoRef} playsInline muted autoPlay aria-label="Camera preview" className="aspect-square w-full object-cover" />
              <div className="pointer-events-none absolute inset-10 rounded-2xl border-2 border-white/70" aria-hidden />
              <Button variant="secondary" size="sm" className="absolute bottom-3 right-3" onClick={() => { stop(); setCamera("idle"); }}>
                Stop
              </Button>
            </div>
          ) : camera === "unsupported" || camera === "checking" ? (
            <Alert tone="info" title="Use your phone's camera app">
              {camera === "checking" ? "Checking your browser…" : "This browser can't scan QR codes here. Point your phone's camera app at the QR code and tap the link, or enter the code below."}
            </Alert>
          ) : (
            <div className="space-y-3 text-center">
              {camera === "denied" && (
                <Alert tone="warning" title="Camera access was blocked">Allow camera access in your browser settings, or enter the code below.</Alert>
              )}
              {camera === "error" && (
                <Alert tone="warning" title="Couldn't start the camera">Close other apps using the camera and try again, or enter the code below.</Alert>
              )}
              <Button onClick={() => void start()} icon={camera === "denied" ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}>
                Scan QR code
              </Button>
              <p className="text-xs text-muted">The camera is only used to read the code. Nothing is recorded or uploaded.</p>
            </div>
          )}

          {problem && <Alert tone="warning" title="Not an event code">{problem}</Alert>}

          <form onSubmit={submit} className="space-y-2">
            <label htmlFor="event-code" className="flex items-center gap-2 text-sm font-medium text-ink">
              <QrCode className="h-4 w-4 text-muted" />Event code or link
            </label>
            <div className="flex gap-2">
              <Input id="event-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off"
                autoCapitalize="none" spellCheck={false} placeholder="e.g. abcd2345wxyz" />
              <Button type="submit" variant="outline" disabled={!code.trim()}>Open</Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
