"use client";

import {
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Folder,
  FolderOpen,
  ImageIcon,
  ImageOff,
  Loader2,
  Lock,
  MapPin,
  RotateCcw,
  ScanFace,
  Search,
  SearchX,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/app-shell";
import { GridSkeleton, Lightbox, PhotoGrid, PhotoTile, type GalleryItem } from "@/components/gallery";
import { MatchResults } from "@/components/match-results";
import { SelfieCapture } from "@/components/selfie-capture";
import { Button } from "@/components/ui/button";
import { Input, Skeleton } from "@/components/ui/primitives";
import { Alert, EmptyState, ErrorState } from "@/components/ui/states";
import { ApiError, errorMessage, publicApi } from "@/lib/api";
import { cn, formatDate, formatNumber } from "@/lib/format";
import { useDebounced, useQuery } from "@/lib/hooks";
import { downloadImage, downloadImagesInBatch, getSavedWatermarkConfig, saveEventWatermarkConfig, type WatermarkConfig } from "@/lib/image";
import type { MatchResponse, PublicEventOut, PublicPhotoItem } from "@/lib/types";

type Stage = "start" | "searching" | "results";

/** Friendly copy for the error codes the match endpoint returns. */
function matchErrorCopy(err: unknown): { title: string; body: string; retake: boolean; retry?: boolean } {
  if (err instanceof ApiError) {
    if (err.code === "network_error" || err.code === "timeout" || err.status >= 500) {
      return {
        title: err.code === "timeout" ? "That took too long" : "Connection problem",
        body: "Your selfie couldn't be sent or matched. Check your mobile data or Wi-Fi, then try again.",
        retake: false, retry: true,
      };
    }
    switch (err.code) {
      case "consent_required":
        return { title: "Please confirm consent first", body: "Tick the box below to agree to how your selfie is used, then take or upload your selfie again.", retake: true };
      case "no_face_detected":
        return { title: "We couldn't see a face", body: "Face the camera in good light, remove sunglasses or masks, and try again.", retake: true };
      case "multiple_faces_detected":
        return { title: "More than one face", body: "Please take a selfie with only your face in the frame.", retake: true };
      case "rate_limited":
        return { title: "Too many tries", body: `Please wait ${err.retryAfter ? `${err.retryAfter} seconds` : "a minute"} and try again.`, retake: false };
      case "file_too_large":
        return { title: "Photo is too large", body: "Try taking a new selfie instead.", retake: true };
      case "face_model_unavailable":
        return { title: "Search is temporarily unavailable", body: "The photographer's system isn't ready yet. Please try again later.", retake: false };
      case "not_found":
        return { title: "Event unavailable", body: "This event is no longer accepting searches.", retake: false };
      case "link_expired":
        return { title: "This link has expired", body: "Ask the event organiser for a new link or QR code.", retake: false };
      case "unsupported_format":
      case "corrupt_image":
      case "invalid_image":
        return { title: "That image couldn't be read", body: "Please take a new selfie or choose a JPEG or PNG photo.", retake: true };
    }
  }
  return { title: "Something went wrong", body: errorMessage(err), retake: true };
}

export function GuestPortal({ slug }: { slug: string }) {
  const event = useQuery(() => publicApi.event(slug), [slug]);

  if (event.error && !event.data) {
    const notFound = event.error instanceof ApiError && event.error.status === 404;
    const expired = event.error instanceof ApiError && event.error.code === "link_expired";
    return (
      <Shell>
        <div className="mx-auto max-w-md px-4 py-16">
          {notFound ? (
            <div className="text-center">
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-200">
                {expired ? <Clock className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
              </div>
              <h1 className="font-display text-2xl font-medium">{expired ? "This link has expired" : <>This event isn&apos;t available</>}</h1>
              <p className="mt-2 text-sm text-muted">
                {expired
                  ? "The organiser set this link to stop working after a certain time. Ask them for a new link or QR code."
                  : "The link may be mistyped, or the organiser has closed the event. Check the QR code or link you were given."}
              </p>
              <a href="/scan" className="mt-5 inline-block text-sm font-semibold text-brand-700 underline">Scan a QR code or enter a code</a>
            </div>
          ) : (
            <ErrorState error={event.error} onRetry={event.reload} />
          )}
        </div>
      </Shell>
    );
  }
  if (!event.data) {
    return (
      <Shell>
        <Skeleton className="h-56 w-full rounded-none sm:h-72" />
        <div className="mx-auto max-w-2xl space-y-3 px-4 py-6">
          <Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="mt-6 h-40 w-full rounded-3xl" />
        </div>
      </Shell>
    );
  }
  return <Portal event={event.data} slug={slug} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      {children}
      <footer className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 pb-10 pt-6 text-center text-xs text-muted">
        <Logo className="scale-90 opacity-80" />
      </footer>
    </div>
  );
}

type PortalTab = "face" | "all";

function Portal({ event, slug }: { event: PublicEventOut; slug: string }) {
  const [activeTab, setActiveTab] = useState<PortalTab>("face");
  const [stage, setStage] = useState<Stage>("start");
  const [consent, setConsent] = useState(false);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [progress, setProgress] = useState(0);
  const [online, setOnline] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const lastSelfie = useRef<Blob | null>(null); // kept in memory only, so a failed upload can be retried
  const resultsRef = useRef<HTMLDivElement>(null);
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig | undefined>(() => getSavedWatermarkConfig(slug));

  useEffect(() => {
    void fetch(`/api/watermark?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.config && typeof data.config === "object") {
          setWatermarkConfig(data.config);
          saveEventWatermarkConfig("", slug, data.config);
        }
      })
      .catch(() => undefined);
  }, [slug]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => () => { if (selfieUrl) URL.revokeObjectURL(selfieUrl); }, [selfieUrl]);

  async function search(blob: Blob) {
    setError(null);
    setResult(null);
    setProgress(0);
    lastSelfie.current = blob;
    setSelfieUrl(URL.createObjectURL(blob));
    setStage("searching");
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await publicApi.match(slug, blob, consent, ctrl.signal, setProgress);
      setResult(r);
      setStage("results");
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(err);
      setStage("start");
    }
  }

  function startOver() {
    abortRef.current?.abort();
    lastSelfie.current = null;
    setResult(null);
    setError(null);
    setSelfieUrl(null); // effect revokes the object URL; the selfie is dropped from memory
    setProgress(0);
    setConsent(false); // consent covers one search: a new search asks again
    setStage("start");
  }

  const copy = error ? matchErrorCopy(error) : null;

  return (
    <Shell>
      {/* Hero */}
      <header className="relative">
        <div className="relative h-64 overflow-hidden bg-brand-950 sm:h-80">
          {event.cover_url ? (
            <img src={event.cover_url} alt="" className="h-full w-full object-cover opacity-90" />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--color-brand-500)_0%,_transparent_60%),radial-gradient(ellipse_at_bottom_left,_var(--color-brand-700)_0%,_transparent_55%)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 mx-auto max-w-2xl px-4 pb-6 text-white">
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium backdrop-blur">
              <ImageIcon className="h-3.5 w-3.5" />{formatNumber(event.photo_count)} photos
            </p>
            <h1 className="font-display text-3xl font-medium leading-tight sm:text-4xl">{event.name}</h1>
            <span className="mt-3 block h-px w-14 bg-brand-300" aria-hidden />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/90">
              {event.event_date && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{formatDate(event.event_date, { day: "numeric", month: "long", year: "numeric" })}</span>}
              {event.venue && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{event.venue}</span>}
            </div>
          </div>
        </div>
      </header>

      <main className={cn("mx-auto px-4 pb-16 transition-all", activeTab === "all" ? "max-w-5xl" : "max-w-2xl")}>
        {event.description && <p className="mt-6 whitespace-pre-line text-[15px] leading-relaxed text-ink/80">{event.description}</p>}

        {/* Tab Switcher: Find My Face (Selfie) vs Browse All Photos */}
        <div className="mt-6 flex rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab("face")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-xs sm:text-sm transition-all select-none cursor-pointer",
              activeTab === "face"
                ? "bg-brand-50 text-brand-700 shadow-xs border border-brand-200 font-bold"
                : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 font-medium",
            )}
          >
            <ScanFace className={cn("h-4 w-4", activeTab === "face" ? "text-brand-600" : "text-zinc-500")} />
            <span className={activeTab === "face" ? "text-brand-700 font-bold" : "text-zinc-600 font-medium"}>Find My Face (Selfie)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-xs sm:text-sm transition-all select-none cursor-pointer",
              activeTab === "all"
                ? "bg-brand-50 text-brand-700 shadow-xs border border-brand-200 font-bold"
                : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 font-medium",
            )}
          >
            <ImageIcon className={cn("h-4 w-4", activeTab === "all" ? "text-brand-600" : "text-zinc-500")} />
            <span className={activeTab === "all" ? "text-brand-700 font-bold" : "text-zinc-600 font-medium"}>Browse All Photos ({formatNumber(event.photo_count)})</span>
          </button>
        </div>

        {activeTab === "all" ? (
          <AllPhotosView slug={slug} event={event} watermarkConfig={watermarkConfig} />
        ) : (
          <>
            {!online && (
              <Alert tone="warning" className="mt-6" icon={<WifiOff className="h-4 w-4" />} title="You're offline">
                Photos can&apos;t be searched or downloaded until your mobile data or Wi-Fi reconnects.
              </Alert>
            )}

            {stage !== "results" && (
              <section className="mt-6 rounded-3xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-7" aria-labelledby="find-heading">
                <h2 id="find-heading" className="font-display text-2xl font-medium">Find your photos</h2>
                <ol className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    { icon: Camera, title: "Take a selfie", text: "Or upload a clear photo of your face." },
                    { icon: ScanFace, title: "We match faces", text: "Only within this event's photos." },
                    { icon: CheckCircle2, title: "See your photos", text: "View and download them instantly." },
                  ].map(({ icon: Icon, title, text }, i) => (
                    <li key={title} className="flex gap-3 rounded-2xl border border-line bg-canvas p-3 sm:flex-col sm:gap-2">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
                      <div>
                        <p className="text-sm font-semibold"><span className="sr-only">Step {i + 1}: </span>{title}</p>
                        <p className="text-xs text-muted">{text}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                {!event.matching_available && (
                  <Alert tone="warning" className="mt-5" title="Photo search isn't available yet">
                    The organiser&apos;s system is still being set up. Please check back later.
                  </Alert>
                )}
                {event.matching_available && event.photo_count === 0 && (
                  <Alert tone="info" className="mt-5" icon={<Clock className="h-4 w-4" />} title="Photos are on their way">
                    No photos have been published yet. Check back soon. You can still try a search.
                  </Alert>
                )}

                {copy && (
                  <Alert tone={copy.retake ? "warning" : "error"} className="mt-5" title={copy.title}>
                    {copy.body}
                    {copy.retry && lastSelfie.current && consent && (
                      <div className="mt-3">
                        <Button size="sm" variant="secondary" icon={<RotateCcw className="h-4 w-4" />}
                                onClick={() => lastSelfie.current && void search(lastSelfie.current)}>
                          Try again with the same selfie
                        </Button>
                      </div>
                    )}
                  </Alert>
                )}

                {stage === "searching" ? (
                  <div className="mt-6 flex flex-col items-center gap-4 py-6 text-center" role="status" aria-live="polite">
                    <div className="relative">
                      {selfieUrl && <img src={selfieUrl} alt="Your selfie" className="h-28 w-28 rounded-full object-cover ring-4 ring-brand-100" />}
                      <span className="absolute inset-0 animate-ping rounded-full ring-2 ring-brand-400" aria-hidden />
                    </div>
                    <div className="w-full max-w-xs">
                      {progress < 1 ? (
                        <>
                          <p className="font-semibold">Uploading your selfie… {Math.round(progress * 100)}%</p>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100" role="progressbar"
                               aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                            <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="font-semibold">Searching {formatNumber(event.photo_count)} photos…</p>
                          <p className="text-sm text-muted">This usually takes a few seconds.</p>
                        </>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={startOver}>Cancel</Button>
                  </div>
                ) : (
                  <div className="mt-6 space-y-4">
                    <label className="flex cursor-pointer gap-3 rounded-2xl border border-line p-4 transition has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50/50">
                      <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                             className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand-600)]" />
                      <span className="text-sm leading-relaxed text-ink/85">
                        I agree to use my selfie to find my event photos. Selfies are processed in memory and never stored.
                      </span>
                    </label>
                    <SelfieCapture onCapture={search} disabled={!consent || !event.matching_available} />
                    {!consent && <p className="text-center text-xs text-muted">Tick the box above to continue.</p>}
                  </div>
                )}
              </section>
            )}

            {stage === "results" && result && (
              <section ref={resultsRef} className="mt-6 scroll-mt-4" aria-labelledby="results-heading">
                <div className="mb-4 flex items-center justify-between gap-3 rounded-3xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
                  <div className="flex min-w-0 items-center gap-3">
                    {selfieUrl && <img src={selfieUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-brand-100" />}
                    <div className="min-w-0">
                      <h2 id="results-heading" className="font-display text-xl font-medium">
                        {result.total ? `We found ${formatNumber(result.total)} photo${result.total === 1 ? "" : "s"} of you` : "No photos found yet"}
                      </h2>
                      <p className="text-xs text-muted">Tap a photo to view it. Download saves the original, full-quality file.</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={startOver} icon={<RotateCcw className="h-4 w-4" />}>
                    <span className="hidden sm:inline">New search</span>
                  </Button>
                </div>
                <MatchResults key={result.match_token ?? "empty"} initial={result}
                  loadPage={(token, cursor) => publicApi.matchPage(slug, token, cursor)}
                  downloadPrefix={event.name.replace(/[^\w-]+/g, "-").toLowerCase()}
                  emptyTitle="We didn't find you in these photos yet"
                  emptyDescription="More photos may still be uploading. You can also try a clearer, front-facing selfie in good light."
                  onExpired={startOver}
                  watermarkConfig={watermarkConfig} />
                {result.total === 0 && (
                  <div className="mt-2 flex justify-center">
                    <Button onClick={startOver} icon={<SearchX className="h-4 w-4" />} variant="secondary">Try another selfie</Button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </Shell>
  );
}

function AllPhotosView({ slug, event: _event, watermarkConfig }: { slug: string; event: PublicEventOut; watermarkConfig?: WatermarkConfig }) {
  const [photos, setPhotos] = useState<PublicPhotoItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const dq = useDebounced(searchQuery.trim(), 300);
  const [cursor, setCursor] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  const loadPhotos = useCallback(async (fld: string, q: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await publicApi.listPhotos(slug, {
        folder: fld === "all" ? undefined : fld,
        q: q || undefined,
        cursor: 0,
        limit: 48,
      });
      setPhotos(page.items);
      setTotal(page.total);
      setCursor(page.next_cursor);
      setFolders(page.folders);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void loadPhotos(selectedFolder, dq);
  }, [loadPhotos, selectedFolder, dq]);

  const loadMore = async () => {
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await publicApi.listPhotos(slug, {
        folder: selectedFolder === "all" ? undefined : selectedFolder,
        q: dq || undefined,
        cursor,
        limit: 48,
      });
      setPhotos((prev) => {
        const seen = new Set(prev.map((p) => p.photo_id));
        return [...prev, ...page.items.filter((p) => !seen.has(p.photo_id))];
      });
      setCursor(page.next_cursor);
    } catch (err) {
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleSelect = (photoId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === photos.length && photos.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(photos.map((p) => p.photo_id)));
    }
  };

  const downloadBatch = async (targets: PublicPhotoItem[]) => {
    if (targets.length === 0) return;
    setBatchDownloading(true);
    setBatchProgress({ done: 0, total: targets.length });
    const downloadList = targets
      .map((p) => {
        const url = p.download_url ?? p.preview_url;
        if (!url) return null;
        return {
          url,
          filename: p.original_filename || `photo-${p.photo_id.slice(0, 8)}.jpg`,
        };
      })
      .filter((x): x is { url: string; filename: string } => x !== null);

    try {
      await downloadImagesInBatch(downloadList, watermarkConfig, (done, total) => {
        setBatchProgress({ done, total });
      });
    } catch (err) {
      console.error("Batch download failed", err);
    } finally {
      setBatchDownloading(false);
      setBatchProgress(null);
    }
  };

  const downloadAllEventPhotos = async () => {
    setBatchDownloading(true);
    try {
      let allItems: PublicPhotoItem[] = [...photos];
      let currentCursor = cursor;

      while (currentCursor !== null) {
        setBatchProgress({ done: allItems.length, total: Math.max(total, allItems.length) });
        const page = await publicApi.listPhotos(slug, {
          folder: selectedFolder === "all" ? undefined : selectedFolder,
          q: dq || undefined,
          cursor: currentCursor,
          limit: 100,
        });
        const seen = new Set(allItems.map((p) => p.photo_id));
        const newItems = page.items.filter((p) => !seen.has(p.photo_id));
        allItems = [...allItems, ...newItems];
        currentCursor = page.next_cursor;
        if (!page.items.length) break;
      }

      await downloadBatch(allItems);
    } catch (err) {
      console.error("Download all photos failed", err);
    } finally {
      setBatchDownloading(false);
    }
  };

  const allSelected = photos.length > 0 && selectedIds.size === photos.length;
  const gallery: GalleryItem[] = photos.map((p, i) => ({
    id: p.photo_id,
    thumbnailUrl: p.thumbnail_url,
    previewUrl: p.preview_url,
    alt: p.original_filename || `Photo ${i + 1}`,
  }));

  return (
    <section className="mt-6 space-y-4" aria-label="All event photos">
      {/* Folder Chips & Search Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input
            type="search"
            placeholder="Search by filename"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-xs"
          />
        </div>

        {folders.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              type="button"
              onClick={() => setSelectedFolder("all")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition",
                selectedFolder === "all"
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-canvas text-muted hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-ink",
              )}
            >
              <Folder className="h-3.5 w-3.5" /> All ({total})
            </button>
            {folders.map((fld) => (
              <button
                key={fld}
                type="button"
                onClick={() => setSelectedFolder(fld)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition",
                  selectedFolder === fld
                    ? "bg-brand-600 text-white shadow-sm"
                    : "bg-canvas text-muted hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-ink",
                )}
              >
                <FolderOpen className="h-3.5 w-3.5" /> {fld}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selection & Download Actions */}
      {photos.length > 0 && (
        <div className="sticky top-2 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/95 p-3.5 shadow-md backdrop-blur-md sm:px-4">
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink select-none">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={selectAll}
                className="h-4 w-4 rounded border-zinc-300 text-brand-600 accent-brand-600 focus:ring-brand-500"
              />
              <span>{allSelected ? "Deselect all" : "Select all photos"}</span>
            </label>
            {selectedIds.size > 0 && (
              <span className="inline-flex items-center rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-800">
                {selectedIds.size} of {photos.length} selected
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.size > 0 && (
              <Button
                size="sm"
                onClick={() => void downloadBatch(photos.filter((p) => selectedIds.has(p.photo_id)))}
                disabled={batchDownloading}
                icon={batchDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              >
                {batchDownloading && batchProgress
                  ? `Downloading (${batchProgress.done}/${batchProgress.total})…`
                  : `Download selected (${selectedIds.size})`}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void downloadAllEventPhotos()}
              disabled={batchDownloading}
              icon={batchDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            >
              {batchDownloading && batchProgress
                ? `Downloading (${batchProgress.done}/${batchProgress.total})…`
                : `Download all (${total || photos.length})`}
            </Button>
          </div>
        </div>
      )}

      {error ? (
        <Alert tone="error" title="Couldn't load photos">
          {errorMessage(error)}
        </Alert>
      ) : loading ? (
        <GridSkeleton count={12} />
      ) : photos.length === 0 ? (
        <EmptyState
          icon={<ImageOff className="h-6 w-6 text-muted" />}
          title={searchQuery || selectedFolder !== "all" ? "No photos found" : "No photos published yet"}
          description={
            searchQuery || selectedFolder !== "all"
              ? "Try clearing your filters or searching for something else."
              : "The photographer hasn't published photos for this event yet. Check back soon!"
          }
        />
      ) : (
        <div className="space-y-6">
          <PhotoGrid>
            {photos.map((p, i) => {
              const isSelected = selectedIds.has(p.photo_id);
              return (
                <PhotoTile
                  key={p.photo_id}
                  src={p.thumbnail_url}
                  alt={p.original_filename || `Photo ${i + 1}`}
                  selected={isSelected}
                  onClick={() => setOpenIndex(i)}
                  overlay={
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(p.photo_id);
                      }}
                      aria-label={isSelected ? "Deselect photo" : "Select photo"}
                      className={cn(
                        "absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border shadow-sm transition-all",
                        isSelected
                          ? "border-brand-600 bg-brand-600 text-white shadow-brand-600/30"
                          : "border-white/80 bg-black/40 text-transparent hover:border-white hover:bg-black/60",
                      )}
                    >
                      <Check className={cn("h-3.5 w-3.5 stroke-[3]", isSelected ? "opacity-100" : "opacity-0")} />
                    </button>
                  }
                />
              );
            })}
          </PhotoGrid>

          {cursor !== null && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={loadMore} loading={loadingMore}>
                {loadingMore ? "Loading more photos…" : `Show more (${total - photos.length} left)`}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Floating Bottom Bar for Mobile */}
      {photos.length > 0 && (
        <div className="fixed bottom-4 left-3 right-3 z-50 flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-2xl backdrop-blur-lg dark:border-zinc-700 dark:bg-zinc-900/95 sm:hidden">
          <div className="flex items-center gap-2 min-w-0">
            {selectedIds.size > 0 ? (
              <>
                <span className="inline-flex h-6 items-center justify-center rounded-full bg-brand-600 px-2.5 text-xs font-bold text-white shadow-sm">
                  {selectedIds.size}
                </span>
                <span className="truncate text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  Selected
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs font-semibold text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-200 ml-1"
                >
                  Clear
                </button>
              </>
            ) : (
              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                {total || photos.length} photos
              </span>
            )}
          </div>
          {selectedIds.size > 0 ? (
            <Button
              size="sm"
              onClick={() => void downloadBatch(photos.filter((p) => selectedIds.has(p.photo_id)))}
              disabled={batchDownloading}
              className="bg-brand-600 text-white font-bold shadow-md active:scale-95 transition-transform"
              icon={batchDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            >
              {batchDownloading && batchProgress
                ? `${batchProgress.done}/${batchProgress.total}…`
                : `Download (${selectedIds.size})`}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void downloadAllEventPhotos()}
              disabled={batchDownloading}
              className="bg-brand-600 text-white font-bold shadow-md active:scale-95 transition-transform"
              icon={batchDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            >
              {batchDownloading && batchProgress
                ? `${batchProgress.done}/${batchProgress.total}…`
                : `Download all (${total || photos.length})`}
            </Button>
          )}
        </div>
      )}

      <Lightbox
        items={gallery}
        index={openIndex}
        onIndexChange={setOpenIndex}
        onClose={() => setOpenIndex(null)}
        toolbar={(item) => {
          const p = photos.find((x) => x.photo_id === item.id);
          if (!p) return null;
          const url = p.download_url ?? p.preview_url;
          if (!url) return null;
          return (
            <button
              onClick={() => void downloadImage(url, p.original_filename || "photo.jpg", watermarkConfig)}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-white/15 px-4 text-sm font-medium text-white hover:bg-white/25"
            >
              <Download className="h-4 w-4" />
              Download
            </button>
          );
        }}
      />
    </section>
  );
}
