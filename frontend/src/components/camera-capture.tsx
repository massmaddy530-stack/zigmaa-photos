"use client";

import { AlertTriangle, Camera, CheckCircle2, Clock, Copy, ImagePlus, Loader2, LogIn, RotateCcw, Save, Trash2, WifiOff, XCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_MB } from "@/lib/config";
import { cn, formatBytes, formatNumber } from "@/lib/format";
import { optimizePhotoForUpload } from "@/lib/image";
import { CaptureBuffer, UploadQueue, type PendingCapture, type QueueItem, type QueueItemStatus, type QueueSnapshot } from "@/lib/upload-queue";
import { LiveCamera, liveCameraSupported } from "./live-camera";
import { Button, buttonClass } from "./ui/button";
import { Card, ProgressBar } from "./ui/primitives";
import { Alert } from "./ui/states";
import { useToast } from "./ui/toast";

const STATUS_TEXT: Record<QueueItemStatus, string> = {
  pending: "Queued", uploading: "Uploading", retrying: "Retry pending", failed: "Failed", rejected: "Failed (rejected)",
};

const ACCEPT = ACCEPTED_IMAGE_TYPES.filter((t) => t !== "image/mpo").join(",");
/** Camera photos held in memory while they are written to on-device storage; beyond this the shutter waits. */
const MAX_UNSAVED = 5;

/**
 * Phone capture. With a secure connection (HTTPS) the in-page live camera takes photos with no review screen; over
 * plain HTTP it falls back to the phone's camera app. Every photo is saved on the device first, then uploaded by the
 * persistent queue while this page stays open. Taking photos never waits for uploads.
 */
export function CameraCapture({ eventId, disabled }: { eventId: string; disabled?: boolean }) {
  const toast = useToast();
  const pathname = usePathname();
  const queueRef = useRef<UploadQueue | null>(null);
  const bufferRef = useRef<CaptureBuffer | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [snap, setSnap] = useState<QueueSnapshot | null>(null);
  const [unsaved, setUnsaved] = useState<readonly PendingCapture[]>([]);
  const [initError, setInitError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => setLive(liveCameraSupported()), []);

  useEffect(() => {
    let queue: UploadQueue;
    try {
      queue = new UploadQueue({ eventId });
    } catch (err) {
      setInitError(err instanceof Error ? err.message : "This browser cannot store photos for upload.");
      return;
    }
    queueRef.current = queue;
    const buffer = new CaptureBuffer((file, id) => queue.add(file, { id }), MAX_UNSAVED);
    bufferRef.current = buffer;
    const unsubscribeQueue = queue.subscribe(setSnap);
    const unsubscribeBuffer = buffer.subscribe(setUnsaved);
    queue.open().catch(() => setInitError("Could not open on-device photo storage (private browsing may block it)."));
    return () => {
      unsubscribeQueue();
      unsubscribeBuffer();
      queue.dispose();
      queueRef.current = null;
      bufferRef.current = null;
    };
  }, [eventId]);

  const items = snap?.items ?? [];
  const count = (...s: QueueItemStatus[]) => items.filter((i) => s.includes(i.status)).length;
  const queued = count("pending", "retrying");
  const uploading = count("uploading");
  const problems = count("failed", "rejected");
  const saveErrors = unsaved.filter((p) => p.error).length;
  const notSafe = unsaved.length + queued + uploading;
  const full = unsaved.filter((p) => !p.invalid).length >= MAX_UNSAVED;

  // Leaving now would lose unsaved photos (still in memory) and pause uploads of saved ones.
  useEffect(() => {
    if (!notSafe) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [notSafe]);

  const onCapture = useCallback(async (file: File) => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    const readyFile = await optimizePhotoForUpload(file);
    if (buffer.push(readyFile) === null) {
      // The shutter is disabled while full, so this only happens in a race; keep the photo rather than drop it.
      buffer.push(readyFile, { bypassLimit: true });
    }
  }, []);

  const onCameraError = useCallback((message: string) => toast.error("Camera problem", message), [toast]);

  async function addPicked(list: FileList | null) {
    const buffer = bufferRef.current;
    if (!list || !buffer || disabled) return;
    for (const file of Array.from(list)) {
      const readyFile = await optimizePhotoForUpload(file);
      buffer.push(readyFile, { bypassLimit: true }); // already on disk, not in memory
    }
  }

  if (initError) {
    return <Alert tone="error" title="Camera uploads are not available in this browser">{initError}</Alert>;
  }

  const ready = !!snap?.ready && !disabled;

  return (
    <div className="space-y-4">
      {disabled && <Alert tone="warning" title="This event is archived">Make it live again in Settings to add photos. Saved photos stay on this phone.</Alert>}
      {snap?.block === "signin" && (
        <Alert tone="error" title="Sign in again to continue" icon={<LogIn className="h-4 w-4" />}>
          <p>{snap.blockMessage} Your photos are saved on this phone and will upload after you sign in.</p>
          <Link href={`/login?next=${encodeURIComponent(pathname)}`} className={buttonClass("outline", "sm", "mt-2")}>Sign in</Link>
        </Alert>
      )}
      {snap?.block === "archived" && (
        <Alert tone="warning" title="Uploads paused">
          <p>{snap.blockMessage} Saved photos stay on this phone.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => queueRef.current?.resume()}>Try again</Button>
        </Alert>
      )}
      {snap && !snap.online && (
        <Alert tone="warning" title="No connection" icon={<WifiOff className="h-4 w-4" />}>
          Keep taking photos. They are saved on this phone and upload automatically when Wi-Fi comes back.
        </Alert>
      )}
      {saveErrors > 0 && (
        <Alert tone="error" title={`${formatNumber(saveErrors)} photo${saveErrors === 1 ? "" : "s"} not saved yet`}>
          They are still held on this page. Tap Retry save below; do not close the page until they are saved.
        </Alert>
      )}

      <StatusStrip saving={unsaved.length - saveErrors} queued={queued} uploading={uploading}
                   uploaded={(snap?.uploaded ?? 0) + (snap?.duplicates ?? 0)} problems={problems + saveErrors} />

      <Card className="overflow-hidden p-0 pb-4 sm:p-5">
        {live && ready ? (
          <LiveCamera onCapture={onCapture} blocked={full} blockedLabel="Saving photos… one moment" onError={onCameraError} />
        ) : (
          <div className="grid gap-3 px-4 pt-4 sm:p-0">
            <Button className="h-16 text-base" disabled={!ready} loading={!snap?.ready && !disabled}
                    onClick={() => cameraInput.current?.click()} icon={<Camera className="h-6 w-6" />}>
              Take photo
            </Button>
            {!live && (
              <p className="text-xs text-muted">
                Continuous capture needs a secure (https://) connection. Over plain http the phone&apos;s camera app opens
                for each photo and asks you to confirm it.
              </p>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-4 sm:px-0">
          <p className="text-xs text-muted">JPEG, PNG or WebP · up to {MAX_UPLOAD_MB} MB · duplicates are skipped automatically</p>
          <Button size="touch" variant="outline" disabled={!ready} onClick={() => galleryInput.current?.click()} icon={<ImagePlus className="h-4 w-4" />}>
            Choose from gallery
          </Button>
        </div>
        <input ref={cameraInput} type="file" accept={ACCEPT} capture="environment" className="sr-only" tabIndex={-1}
               onChange={(e) => { addPicked(e.target.files); e.target.value = ""; }} />
        <input ref={galleryInput} type="file" accept={ACCEPT} multiple className="sr-only" tabIndex={-1}
               onChange={(e) => { addPicked(e.target.files); e.target.value = ""; }} />
      </Card>

      <Alert tone="info" title="Keep this page open while photos upload">
        Uploads only run while this page is open. If you close it or the phone locks, saved photos stay on this phone
        and continue the next time you open this page. The browser may still clear saved photos if the phone runs low
        on storage, so wait until <strong>Queued</strong> and <strong>Uploading</strong> show 0 before leaving.
      </Alert>

      <Card>
        {problems > 0 && (
          <div className="flex justify-end border-b border-line px-5 py-3">
            <Button size="sm" variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={() => void queueRef.current?.retryAll()}>
              Retry failed
            </Button>
          </div>
        )}
        {unsaved.length + items.length + (snap?.completed.length ?? 0) === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Photos you take appear here with their upload status.</p>
        ) : (
          <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto px-5 py-2">
            {unsaved.slice().reverse().map((p) => (
              <UnsavedRow key={p.id} item={p} onRetry={() => bufferRef.current?.retry(p.id)}
                          onDiscard={() => {
                            if (window.confirm(`${p.file.name} is not saved. Remove it permanently?`)) bufferRef.current?.discard(p.id);
                          }} />
            ))}
            {items.slice().reverse().map((it) => (
              <QueueRow key={it.id} item={it} progress={snap?.progress[it.id]}
                        onRetry={() => void queueRef.current?.retry(it.id)}
                        onDiscard={() => {
                          if (window.confirm(`Remove ${it.name} from this phone without uploading it?`)) void queueRef.current?.discard(it.id);
                        }} />
            ))}
            {snap?.completed.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                {c.result === "uploaded"
                  ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Uploaded" />
                  : <Copy className="h-5 w-5 shrink-0 text-brand-400" aria-label="Duplicate" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{c.name}</p>
                  <p className="text-xs text-muted">
                    {c.result === "uploaded" ? "Uploaded" : "Duplicate (already in this event)"}{c.restored ? " · missing file restored" : ""} · processing on the server
                  </p>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted">{formatBytes(c.size)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StatusStrip({ saving, queued, uploading, uploaded, problems }: {
  saving: number; queued: number; uploading: number; uploaded: number; problems: number;
}) {
  const cells: [string, number, string?][] = [
    ["Saving", saving], ["Queued", queued], ["Uploading", uploading], ["Uploaded", uploaded], ["Failed", problems, problems ? "text-red-600" : undefined],
  ];
  return (
    <div className="sticky top-14 z-10 grid grid-cols-5 gap-px overflow-hidden rounded-xl border border-brand-200 bg-brand-200 text-center shadow-[var(--shadow-card)] lg:top-2" aria-live="polite">
      {cells.map(([label, value, cls]) => (
        <div key={label} className="bg-surface px-1 py-2">
          <p className={cn("text-base font-semibold tabular-nums text-ink", cls)}>{formatNumber(value)}</p>
          <p className="text-xs text-muted">{label}</p>
        </div>
      ))}
    </div>
  );
}

function UnsavedRow({ item, onRetry, onDiscard }: { item: PendingCapture; onRetry: () => void; onDiscard: () => void }) {
  return (
    <li className="flex items-center gap-3 py-3">
      {item.error ? <XCircle className="h-5 w-5 shrink-0 text-red-500" aria-label="Not saved" />
        : <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand-500" aria-label="Saving" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-medium text-ink">{item.file.name}</p>
          <span className="shrink-0 text-xs tabular-nums text-muted">{formatBytes(item.file.size)}</span>
        </div>
        <p className={cn("text-xs", item.error ? "text-red-600" : "text-muted")}>
          {item.error ? `Not saved · ${item.error}` : "Saving on this phone…"}
        </p>
      </div>
      {item.error && (
        <div className="flex shrink-0 gap-1">
          {!item.invalid && <Button size="touch" variant="ghost" onClick={onRetry} aria-label={`Retry saving ${item.file.name}`} icon={<Save className="h-4 w-4" />}>Retry save</Button>}
          <Button size="touch" variant="ghost" onClick={onDiscard} aria-label={`Discard ${item.file.name}`} icon={<Trash2 className="h-4 w-4" />} />
        </div>
      )}
    </li>
  );
}

function QueueRow({ item, progress, onRetry, onDiscard }: {
  item: QueueItem;
  progress?: number;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const problem = item.status === "failed" || item.status === "rejected";
  return (
    <li className="flex items-center gap-3 py-3">
      <RowIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-medium text-ink">{item.name}</p>
          <span className="shrink-0 text-xs tabular-nums text-muted">{formatBytes(item.size)}</span>
        </div>
        {item.status === "uploading" ? (
          <ProgressBar value={progress ?? 0} className="mt-1.5 h-1.5" label={`Uploading ${item.name}`} />
        ) : (
          <p className={cn("text-xs", problem ? "text-red-600" : "text-muted")}>
            {STATUS_TEXT[item.status]}{item.message ? ` · ${item.message}` : ""}
          </p>
        )}
      </div>
      {item.status !== "uploading" && (
        <div className="flex shrink-0 gap-1">
          {(problem || item.status === "retrying") && (
            <Button size="touch" variant="ghost" onClick={onRetry} aria-label={`Retry ${item.name}`} icon={<RotateCcw className="h-4 w-4" />} />
          )}
          <Button size="touch" variant="ghost" onClick={onDiscard} aria-label={`Discard ${item.name}`} icon={<Trash2 className="h-4 w-4" />} />
        </div>
      )}
    </li>
  );
}

function RowIcon({ status }: { status: QueueItemStatus }) {
  const cls = "h-5 w-5 shrink-0";
  switch (status) {
    case "uploading": return <Loader2 className={cn(cls, "animate-spin text-brand-600")} aria-label="Uploading" />;
    case "retrying": return <AlertTriangle className={cn(cls, "text-amber-500")} aria-label="Retry pending" />;
    case "failed":
    case "rejected": return <XCircle className={cn(cls, "text-red-500")} aria-label="Failed" />;
    default: return <Clock className={cn(cls, "text-muted")} aria-label="Queued" />;
  }
}
