"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Heart,
  ImageOff,
  Loader2,
  MapPin,
  Search,
  Send,
  Sparkles,
} from "lucide-react";

import { Lightbox, type GalleryItem } from "@/components/gallery";
import { Button } from "@/components/ui/button";
import { Field, Input, Skeleton, Textarea } from "@/components/ui/primitives";
import { Alert, EmptyState } from "@/components/ui/states";
import { errorMessage, publicSelectApi } from "@/lib/api";
import { cn, formatDate } from "@/lib/format";
import type { PublicEventOut, PublicPhotoItem } from "@/lib/types";

export function ClientSelector({ slug, token }: { slug: string; token: string }) {
  const [event, setEvent] = useState<PublicEventOut | null>(null);
  const [photos, setPhotos] = useState<PublicPhotoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "selected">("all");
  const [selectedMap, setSelectedMap] = useState<Map<string, PublicPhotoItem>>(new Map());
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  // Submit modal state
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [clientName, setClientName] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedInfo, setSubmittedInfo] = useState<{
    id: string;
    client_name: string;
    photo_count: number;
  } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Restore saved draft from localStorage for this event slug
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`zigmaa_client_sel_${slug}`);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          clientName?: string;
          note?: string;
          selectionId?: string;
        };
        if (parsed.clientName) setClientName(parsed.clientName);
        if (parsed.note) setNote(parsed.note);
      }
    } catch {}
  }, [slug]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!token) {
        setError(new Error("Missing selection token. Please ask your photographer for the full link."));
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [evRes, phRes] = await Promise.all([
          publicSelectApi.getEvent(slug, token),
          publicSelectApi.listPhotos(slug, token, { cursor: 0, limit: 60 }),
        ]);
        if (!active) return;
        setEvent(evRes.event);
        setPhotos(phRes.items);
        setTotal(phRes.total);
        setNextCursor(phRes.next_cursor);
      } catch (err) {
        if (active) setError(err);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [slug, token]);

  useEffect(() => {
    if (!token || !event) return;
    let active = true;
    async function search() {
      try {
        const phRes = await publicSelectApi.listPhotos(slug, token, {
          q: debouncedQuery || undefined,
          cursor: 0,
          limit: 60,
        });
        if (!active) return;
        setPhotos(phRes.items);
        setTotal(phRes.total);
        setNextCursor(phRes.next_cursor);
      } catch {}
    }
    void search();
    return () => {
      active = false;
    };
  }, [debouncedQuery, slug, token, event]);

  const loadMore = useCallback(async () => {
    if (nextCursor === null || loadingMore || !token) return;
    setLoadingMore(true);
    try {
      const res = await publicSelectApi.listPhotos(slug, token, {
        q: debouncedQuery || undefined,
        cursor: nextCursor,
        limit: 60,
      });
      setPhotos((prev) => [...prev, ...res.items]);
      setNextCursor(res.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, token, slug, debouncedQuery]);

  const togglePhoto = useCallback((photo: PublicPhotoItem) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(photo.photo_id)) {
        next.delete(photo.photo_id);
      } else {
        next.set(photo.photo_id, photo);
      }
      return next;
    });
  }, []);

  const visiblePhotos = useMemo(() => {
    if (viewMode === "selected") {
      const arr = Array.from(selectedMap.values());
      if (!debouncedQuery) return arr;
      const q = debouncedQuery.toLowerCase();
      return arr.filter((p) => p.original_filename.toLowerCase().includes(q));
    }
    return photos;
  }, [viewMode, selectedMap, photos, debouncedQuery]);

  const lightboxItems: GalleryItem[] = useMemo(
    () =>
      visiblePhotos.map((p) => ({
        id: p.photo_id,
        thumbnailUrl: p.thumbnail_url,
        previewUrl: p.preview_url,
        alt: p.original_filename,
      })),
    [visiblePhotos],
  );

  const handleSubmitSelection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) {
      setSubmitError("Please enter your name.");
      return;
    }
    if (selectedMap.size === 0) {
      setSubmitError("Please select at least 1 photo.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await publicSelectApi.submitSelection(slug, token, {
        client_name: clientName.trim(),
        note: note.trim() || null,
        photo_ids: Array.from(selectedMap.keys()),
        selection_id: submittedInfo?.id ?? null,
      });
      setSubmittedInfo({
        id: res.id,
        client_name: res.client_name,
        photo_count: res.photo_count,
      });
      try {
        localStorage.setItem(
          `zigmaa_client_sel_${slug}`,
          JSON.stringify({ clientName: res.client_name, note: note.trim(), selectionId: res.id }),
        );
      } catch {}
      setShowSubmitModal(false);
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
        <Skeleton className="h-44 w-full rounded-3xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/3] w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="mx-auto max-w-lg p-6 pt-16">
        <Alert tone="error" title="Selection link unavailable">
          {errorMessage(error)}
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas pb-28">
      {/* Header */}
      <header className="relative overflow-hidden border-b border-line bg-zinc-950 text-white">
        {event.cover_url ? (
          <img
            src={event.cover_url}
            alt=""
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl"
            aria-hidden
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-brand-900 via-zinc-900 to-zinc-950" />
        )}
        <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-rose-300" />
            Client Photo Selection
          </div>
          <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-4xl">
            {event.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/80 sm:text-sm">
            {event.event_date && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                {formatDate(event.event_date)}
              </span>
            )}
            {event.venue && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {event.venue}
              </span>
            )}
            <span>{total} photos</span>
          </div>
          <p className="mt-2 text-xs text-white/75 sm:text-sm">
            Tap the heart icon on the photos you want to shortlist, then tap <strong>Submit Selection</strong> below.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 pt-5 sm:px-6">
        {submittedInfo && (
          <Alert tone="success" title="Selection saved!">
            Thank you, <strong>{submittedInfo.client_name}</strong>! Your{" "}
            <strong>{submittedInfo.photo_count}</strong> selected photo
            {submittedInfo.photo_count === 1 ? "" : "s"} have been sent to the studio. You can still update and re-submit anytime.
          </Alert>
        )}

        {/* Unified Toolbar */}
        <div className="sticky top-2 z-30 flex flex-col gap-3 rounded-2xl border border-line bg-surface/95 p-3.5 shadow-sm backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              type="search"
              placeholder="Search by filename"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode("all")}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-medium transition",
                viewMode === "all"
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-canvas text-muted hover:text-ink",
              )}
            >
              All Photos ({total})
            </button>
            <button
              type="button"
              onClick={() => setViewMode("selected")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition",
                viewMode === "selected"
                  ? "bg-rose-600 text-white shadow-sm"
                  : "bg-canvas text-muted hover:text-ink",
              )}
            >
              <Heart className={cn("h-3.5 w-3.5", selectedMap.size > 0 && "fill-current")} />
              Selected ({selectedMap.size})
            </button>
          </div>
        </div>

        {/* Photo Grid */}
        {visiblePhotos.length === 0 ? (
          <EmptyState
            icon={<ImageOff className="h-6 w-6 text-muted" />}
            title={viewMode === "selected" ? "No photos selected yet" : "No photos found"}
            description={
              viewMode === "selected"
                ? "Switch to All Photos and tap the heart icon on your favourite shots."
                : "Try clearing your search filter."
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {visiblePhotos.map((p, idx) => {
              const isSelected = selectedMap.has(p.photo_id);
              return (
                <div
                  key={p.photo_id}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border bg-surface transition",
                    isSelected
                      ? "border-rose-500 ring-2 ring-rose-500/30"
                      : "border-line hover:border-brand-300",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setLightboxIdx(idx)}
                    className="block aspect-[4/3] w-full overflow-hidden bg-canvas"
                  >
                    <img
                      src={p.thumbnail_url || p.preview_url || ""}
                      alt={p.original_filename}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                  </button>

                  {/* Heart / Select Toggle */}
                  <button
                    type="button"
                    onClick={() => togglePhoto(p)}
                    aria-label={isSelected ? "Remove from selection" : "Add to selection"}
                    className={cn(
                      "absolute right-2.5 top-2.5 flex h-9 w-9 items-center justify-center rounded-full shadow-md backdrop-blur-sm transition",
                      isSelected
                        ? "bg-rose-600 text-white scale-105"
                        : "bg-black/55 text-white hover:bg-black/75",
                    )}
                  >
                    <Heart className={cn("h-4 w-4", isSelected && "fill-current")} />
                  </button>

                  <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-[11px] text-muted">
                    <span className="truncate">{p.original_filename}</span>
                    {isSelected && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-rose-600">
                        <Check className="h-3 w-3" /> Picked
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {viewMode === "all" && nextCursor !== null && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" onClick={loadMore} loading={loadingMore}>
              Load more photos
            </Button>
          </div>
        )}
      </main>

      {/* Sticky Bottom Submit Bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="text-xs sm:text-sm">
            <strong className="text-ink">{selectedMap.size}</strong>{" "}
            <span className="text-muted">
              photo{selectedMap.size === 1 ? "" : "s"} selected
            </span>
          </div>
          <Button
            onClick={() => setShowSubmitModal(true)}
            disabled={selectedMap.size === 0}
            icon={submittedInfo ? <CheckCircle2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          >
            {submittedInfo ? "Update Selection" : "Submit Selection"}
          </Button>
        </div>
      </div>

      {/* Lightbox */}
      <Lightbox
        items={lightboxItems}
        index={lightboxIdx}
        onIndexChange={setLightboxIdx}
        onClose={() => setLightboxIdx(null)}
        toolbar={(item) => {
          const photo = visiblePhotos.find((p) => p.photo_id === item.id);
          if (!photo) return null;
          const isSelected = selectedMap.has(photo.photo_id);
          return (
            <Button
              size="sm"
              variant={isSelected ? "primary" : "outline"}
              onClick={() => togglePhoto(photo)}
              icon={<Heart className={cn("h-4 w-4", isSelected && "fill-current")} />}
            >
              {isSelected ? "Selected (Tap to remove)" : "Select this photo"}
            </Button>
          );
        }}
      />

      {/* Submit Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSubmitSelection}
            className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-xl"
          >
            <div>
              <h2 className="text-base font-semibold text-ink">Submit Selected Photos</h2>
              <p className="mt-0.5 text-xs text-muted">
                Sending <strong>{selectedMap.size}</strong> selected photo
                {selectedMap.size === 1 ? "" : "s"} to the studio.
              </p>
            </div>

            {submitError && <Alert tone="error">{submitError}</Alert>}

            <Field label="Your Name" htmlFor="sel-client-name">
              <Input
                id="sel-client-name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. Aisha & Rohan"
                required
              />
            </Field>

            <Field label="Note for Studio (Optional)" htmlFor="sel-note">
              <Textarea
                id="sel-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Please use these for our main wedding album"
                rows={3}
              />
            </Field>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowSubmitModal(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                icon={submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              >
                {submitting ? "Sending…" : "Confirm & Submit"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
