"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Move,
  RotateCcw,
  Sparkles,
  Sliders,
} from "lucide-react";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { EventForm } from "@/components/event-form";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { adminApi, errorMessage } from "@/lib/api";
import type { WatermarkConfig } from "@/lib/image";

export default function NewEventPage() {
  const router = useRouter();
  const toast = useToast();
  const previewRef = useRef<HTMLDivElement>(null);

  const [live, setLive] = useState<{
    name: string;
    date: string;
    venue: string;
    description: string;
    preview: string | null;
    template: File | null;
    templatePreview: string | null;
  }>({
    name: "",
    date: "",
    venue: "",
    description: "",
    preview: null,
    template: null,
    templatePreview: null,
  });

  // Watermark customization state (MADX defaults: bottom-right corner, 14% size, 40% opacity)
  const [wm, setWm] = useState<WatermarkConfig>({
    imageUrl: null,
    xPercent: 88,
    yPercent: 88,
    sizePercent: 14,
    opacity: 0.40,
    color: "original",
  });

  // Handle clicking anywhere on the preview image to accurately place watermark
  function handlePreviewClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.max(0, Math.min(100, Math.round(((e.clientY - rect.top) / rect.height) * 100)));
    setWm((prev) => ({ ...prev, xPercent: x, yPercent: y }));
  }

  function resetDefaults() {
    setWm({
      imageUrl: live.templatePreview || null,
      xPercent: 88,
      yPercent: 88,
      sizePercent: 14,
      opacity: 0.40,
      color: "original",
    });
    toast.success("Reset to MADX defaults");
  }

  // Active watermark source: uploaded template if present, else fallback MADX logo
  const watermarkSrc = live.templatePreview || wm.imageUrl || "/watermark.png";
  // Active cover image: uploaded cover if present, else default AI marriage couple photo
  const coverSrc = live.preview || "/default-cover.jpg";

  // CSS filter string for live watermark preview
  function getFilterCss(color?: string) {
    if (color === "white") return "brightness(0) invert(1) drop-shadow(0 2px 4px rgba(0,0,0,0.5))";
    if (color === "dark") return "brightness(0) drop-shadow(0 1px 2px rgba(255,255,255,0.4))";
    if (color === "gold") return "brightness(0) saturate(100%) invert(73%) sepia(58%) saturate(541%) hue-rotate(357deg) brightness(97%) contrast(92%) drop-shadow(0 2px 4px rgba(0,0,0,0.4))";
    return "drop-shadow(0 2px 4px rgba(0,0,0,0.3))";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link
            href="/dashboard"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.location.href = "/dashboard";
              }
            }}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink cursor-pointer transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Events
          </Link>
        }
        title="Create event"
        description="Set up the event details, cover image, and watermark template for photo downloads."
      />

      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Event Form Details (5 cols) */}
        <div className="lg:col-span-6 xl:col-span-5">
          <Card>
            <CardHeader
              title="Event information"
              description="Basic information, cover photo and watermark template."
            />
            <div className="p-5 sm:p-6">
              <EventForm
                submitLabel="Create event"
                footerExtra={
                  <Link
                    href="/dashboard"
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        window.location.href = "/dashboard";
                      }
                    }}
                    className="px-3 text-sm font-medium text-muted hover:text-ink cursor-pointer"
                  >
                    Cancel
                  </Link>
                }
                onValuesChange={({ name, date, venue, description, preview, template, templatePreview }) => {
                  setLive({ name, date, venue, description, preview, template, templatePreview });
                  if (templatePreview) {
                    setWm((prev) => ({ ...prev, imageUrl: templatePreview }));
                  }
                }}
                onSubmit={async ({ cover, ...values }) => {
                  const ev = await adminApi.createEvent(values);

                  // Persist watermark configuration for this event and as studio default
                  const finalConfig: WatermarkConfig = {
                    ...wm,
                    imageUrl: live.templatePreview || null,
                  };

                  if (typeof window !== "undefined") {
                    try {
                      localStorage.setItem(`madx_event_watermark_${ev.id}`, JSON.stringify(finalConfig));
                      localStorage.setItem(`madx_event_watermark_${ev.slug}`, JSON.stringify(finalConfig));
                      localStorage.setItem("madx_default_watermark", JSON.stringify(finalConfig));
                    } catch (e) {
                      console.warn("Could not save watermark config", e);
                    }
                  }

                  if (cover) {
                    try {
                      await adminApi.uploadCover(ev.id, cover, cover.name);
                    } catch (err) {
                      toast.error("Event created, but the cover upload failed", errorMessage(err));
                    }
                  }

                  toast.success("Event created", "Now upload your photos.");
                  router.push(`/dashboard/events/${ev.id}?tab=upload`);
                }}
              />
            </div>
          </Card>
        </div>

        {/* Right Column: Live Watermark Studio & Customization Controls (6 or 7 cols) */}
        <div className="space-y-6 lg:col-span-6 xl:col-span-7">
          <Card className="overflow-hidden">
            <CardHeader
              title="Watermark & Template Studio"
              description="Live preview of how your watermark will appear on downloaded photos"
              action={
                <div className="flex items-center gap-2">
                  <Badge tone="brand" dot>
                    Live preview
                  </Badge>
                  <button
                    type="button"
                    onClick={resetDefaults}
                    title="Reset to MADX defaults"
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink transition-colors"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset
                  </button>
                </div>
              }
            />

            {/* Interactive Preview Canvas */}
            <div className="p-5 pb-0">
              <div className="relative rounded-2xl border border-line bg-[#161009]/95 p-3 flex items-center justify-center min-h-[320px] max-h-[560px] overflow-hidden shadow-inner">
                <div
                  ref={previewRef}
                  onClick={handlePreviewClick}
                  className="relative inline-block max-h-[530px] max-w-full cursor-crosshair select-none group"
                >
                  {/* Background Cover Image (User uploaded or Default AI Marriage Couple) */}
                  <img
                    src={coverSrc}
                    alt="Event Cover Preview"
                    className="max-h-[530px] w-auto max-w-full rounded-xl object-contain block shadow-xl transition-opacity duration-300"
                  />

                  {/* Badge indicator on top-left of photo */}
                  <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/75 border border-white/20 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md shadow-md">
                      {live.preview ? "Custom Cover Image" : "Default AI Couple Photo"}
                    </span>
                    {live.templatePreview && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dfa843]/90 border border-[#dfa843] px-2.5 py-1 text-[11px] font-semibold text-[#1c1305] backdrop-blur-md shadow-md">
                        <Sparkles className="h-3 w-3" /> Custom Watermark
                      </span>
                    )}
                  </div>

                  {/* Click hint pill */}
                  <div className="absolute bottom-3 left-3 rounded-md bg-black/75 border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md pointer-events-none flex items-center gap-1.5 shadow-md">
                    <Move className="h-3 w-3 text-brand-300" />
                    <span>Click anywhere on photo to place watermark</span>
                  </div>

                  {/* Live Watermark Overlay Layer */}
                  <div
                    style={{
                      position: "absolute",
                      left: `${wm.xPercent}%`,
                      top: `${wm.yPercent}%`,
                      transform: `translate(-${wm.xPercent}%, -${wm.yPercent}%)`,
                      width: `${wm.sizePercent}%`,
                      opacity: wm.opacity,
                      pointerEvents: "none",
                      transition: "opacity 0.15s ease, filter 0.15s ease",
                    }}
                  >
                    <img
                      src={watermarkSrc}
                      alt="Watermark Overlay"
                      style={{
                        width: "100%",
                        height: "auto",
                        display: "block",
                        filter: getFilterCss(wm.color),
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Customization Controls Panel */}
            <div className="p-5">
              <div className="grid gap-5 sm:grid-cols-2">
                {/* Size & Scale Control */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                      <Sliders className="h-3.5 w-3.5 text-brand-600" />
                      <span>Watermark Size</span>
                    </label>
                    <span className="text-xs font-mono font-medium text-ink">{wm.sizePercent}% of photo width</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    step={1}
                    value={wm.sizePercent ?? 14}
                    onChange={(e) => setWm((prev) => ({ ...prev, sizePercent: Number(e.target.value) }))}
                    className="w-full accent-brand-500 cursor-pointer h-2 bg-line rounded-lg mt-2"
                  />
                </div>

                {/* Transparency / Opacity Control */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-brand-600" />
                      <span>Transparency / Opacity</span>
                    </label>
                    <span className="text-xs font-mono font-medium text-ink">
                      {Math.round((wm.opacity ?? 0.4) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={wm.opacity ?? 0.4}
                    onChange={(e) => setWm((prev) => ({ ...prev, opacity: Number(e.target.value) }))}
                    className="w-full accent-brand-500 cursor-pointer h-2 bg-line rounded-lg mt-2"
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
