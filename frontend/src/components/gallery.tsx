"use client";

import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/format";
import { Modal } from "./ui/modal";
import { Skeleton } from "./ui/primitives";

export interface GalleryItem {
  id: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  alt: string;
}

export function PhotoGrid({ children, dense }: { children: ReactNode; dense?: boolean }) {
  return (
    <ul className={cn("grid gap-2 sm:gap-3",
      dense ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5")}>
      {children}
    </ul>
  );
}

export function PhotoTile({ src, alt, onClick, overlay, placeholder, selected }: {
  src: string | null;
  alt: string;
  onClick?: () => void;
  overlay?: ReactNode;
  placeholder?: ReactNode;
  selected?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <li className="relative">
      <button type="button" onClick={onClick} disabled={!onClick}
        className={cn("group relative block aspect-square w-full overflow-hidden rounded-xl bg-brand-50 ring-offset-2 transition",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 enabled:cursor-zoom-in",
          selected && "ring-2 ring-brand-500")}
        aria-label={alt}>
        {src && !failed ? (
          <>
            {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
            <img src={src} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
                 className={cn("h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]",
                   loaded ? "opacity-100" : "opacity-0")} />
          </>
        ) : (
          <div className="grid h-full w-full place-items-center text-brand-400">
            {failed ? (
              // The image link exists but did not load: the stored file is missing, or the link expired.
              <div className="flex flex-col items-center gap-1 px-2 text-center">
                {placeholder ?? <ImageOff className="h-6 w-6" aria-hidden />}
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Image unavailable</span>
              </div>
            ) : placeholder ?? <ImageOff className="h-6 w-6" aria-hidden />}
          </div>
        )}
        {overlay}
      </button>
    </li>
  );
}

export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <PhotoGrid>
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}><Skeleton className="aspect-square w-full rounded-xl" /></li>
      ))}
    </PhotoGrid>
  );
}

/**
 * Full-screen viewer with keyboard (←/→/Esc) and swipe navigation.
 * `side` renders an optional details panel (desktop: right column, mobile: below the image).
 */
export function Lightbox({ items, index, onIndexChange, onClose, side, toolbar, imageOverlay }: {
  items: GalleryItem[];
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  side?: (item: GalleryItem) => ReactNode;
  toolbar?: (item: GalleryItem) => ReactNode;
  imageOverlay?: (item: GalleryItem) => ReactNode;
}) {
  const item = index !== null ? items[index] : undefined;
  const touchX = useRef<number | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const hasPrev = index !== null && index > 0;
  const hasNext = index !== null && index < items.length - 1;

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && index < items.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onIndexChange]);

  const src = item?.previewUrl ?? item?.thumbnailUrl ?? null;

  return (
    <Modal open={!!item} onClose={onClose} size="xl" bare>
      {item && (
        <div className={cn("flex max-h-[92dvh] flex-col bg-brand-950", side && "lg:flex-row")}>
          <div className="relative flex min-h-[50dvh] flex-1 items-center justify-center lg:min-h-[80dvh]"
               onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
               onTouchEnd={(e) => {
                 if (touchX.current === null) return;
                 const dx = e.changedTouches[0].clientX - touchX.current;
                 if (dx > 50 && hasPrev) onIndexChange(index! - 1);
                 if (dx < -50 && hasNext) onIndexChange(index! + 1);
                 touchX.current = null;
               }}>
            {src ? (
              <div className="relative w-fit max-w-full lg:max-h-[86dvh]">
                {loadedSrc !== src && <div className="absolute inset-0 grid place-items-center"><Skeleton className="h-16 w-16 rounded-full opacity-20" /></div>}
                <img key={src} src={src} alt={item.alt} onLoad={() => setLoadedSrc(src)}
                     className="block max-h-[70dvh] w-auto max-w-full object-contain lg:max-h-[86dvh]" />
                {loadedSrc === src && imageOverlay?.(item)}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-brand-200">
                <ImageOff className="h-8 w-8" aria-hidden />
                <p className="text-sm">Preview not available yet</p>
              </div>
            )}

            <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-3">
              <span className="rounded-full bg-black/40 px-2.5 py-1 text-xs font-medium tabular-nums text-white/90">
                {index! + 1} / {items.length}
              </span>
              <div className="flex items-center gap-1">
                {toolbar?.(item)}
                <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/15" aria-label="Close viewer">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            {hasPrev && (
              <button onClick={() => onIndexChange(index! - 1)} aria-label="Previous photo"
                      className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60 sm:grid">
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            {hasNext && (
              <button onClick={() => onIndexChange(index! + 1)} aria-label="Next photo"
                      className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60 sm:grid">
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
          </div>
          {side && (
            <aside className="max-h-[40dvh] overflow-y-auto border-t border-white/10 bg-surface lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
              {side(item)}
            </aside>
          )}
        </div>
      )}
    </Modal>
  );
}
