"use client";

import {
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock,
  ImageIcon,
  Lock,
  MapPin,
  RotateCcw,
  ScanFace,
  SearchX,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/app-shell";
import { MatchResults } from "@/components/match-results";
import { SelfieCapture } from "@/components/selfie-capture";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { Alert, ErrorState } from "@/components/ui/states";
import { ApiError, errorMessage, publicApi } from "@/lib/api";
import { cn, formatDate, formatNumber } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import type { MatchResponse, PublicEventOut } from "@/lib/types";

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
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-zinc-100 text-zinc-500">
                {expired ? <Clock className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
              </div>
              <h1 className="text-xl font-semibold">{expired ? "This link has expired" : <>This event isn&apos;t available</>}</h1>
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
        <p>Face matching is automated and can make mistakes. Only photos where your face is detected are shown to you.</p>
      </footer>
    </div>
  );
}

function Portal({ event, slug }: { event: PublicEventOut; slug: string }) {
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
        <div className="relative h-56 overflow-hidden bg-brand-950 sm:h-72">
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
            <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{event.name}</h1>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/85">
              {event.event_date && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{formatDate(event.event_date, { day: "numeric", month: "long", year: "numeric" })}</span>}
              {event.venue && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{event.venue}</span>}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4">
        {event.description && <p className="mt-6 whitespace-pre-line text-[15px] leading-relaxed text-ink/80">{event.description}</p>}

        {!online && (
          <Alert tone="warning" className="mt-6" icon={<WifiOff className="h-4 w-4" />} title="You're offline">
            Photos can&apos;t be searched or downloaded until your mobile data or Wi-Fi reconnects.
          </Alert>
        )}

        {stage !== "results" && (
          <section className="mt-6 rounded-3xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-7" aria-labelledby="find-heading">
            <h2 id="find-heading" className="text-lg font-semibold">Find your photos</h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                { icon: Camera, title: "Take a selfie", text: "Or upload a clear photo of your face." },
                { icon: ScanFace, title: "We match faces", text: "Only within this event's photos." },
                { icon: CheckCircle2, title: "See your photos", text: "View and download them instantly." },
              ].map(({ icon: Icon, title, text }, i) => (
                <li key={title} className="flex gap-3 rounded-2xl bg-canvas p-3 sm:flex-col sm:gap-2">
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
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200" role="progressbar"
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
                    I agree that my selfie will be used <strong>once</strong> to create a temporary facial template and compare it with
                    photos from this event. My selfie is <strong>not stored</strong>, and my search results expire after about 15 minutes.
                    If another person is in my selfie, photos of them may also appear in my results; for only my own photos, I&apos;ll
                    take the selfie alone.
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
                  <h2 id="results-heading" className="font-semibold">
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
              onExpired={startOver} />
            {result.total === 0 && (
              <div className="mt-2 flex justify-center">
                <Button onClick={startOver} icon={<SearchX className="h-4 w-4" />} variant="secondary">Try another selfie</Button>
              </div>
            )}
          </section>
        )}

        <section className="mt-8 rounded-3xl bg-surface/60 p-5 text-sm text-muted ring-1 ring-line">
          <p className="flex items-center gap-2 font-semibold text-ink"><ShieldCheck className="h-4 w-4 text-brand-600" />Your privacy</p>
          <ul className={cn("mt-2 list-disc space-y-1 pl-5")}>
            <li>Your selfie is processed in memory for this search only and is never saved.</li>
            <li>You only see photos where your face was detected, never the full gallery.</li>
            <li>Results and image links expire automatically after a short time.</li>
            <li>Matching is automated and may miss photos or, rarely, show someone who looks similar. Please check each photo before downloading.</li>
          </ul>
        </section>
      </main>
    </Shell>
  );
}
