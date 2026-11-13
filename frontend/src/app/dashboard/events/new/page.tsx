"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Move,
  Palette,
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

const POS_PRESETS = [
  { id: "top_left", label: "TL", title: "Top Left", x: 5, y: 5 },
  { id: "top_center", label: "TC", title: "Top Center", x: 50, y: 5 },
  { id: "top_right", label: "TR", title: "Top Right", x: 95, y: 5 },
  { id: "center_left", label: "ML", title: "Mid Left", x: 5, y: 50 },
  { id: "center", label: "C", title: "Center", x: 50, y: 50 },
  { id: "center_right", label: "MR", title: "Mid Right", x: 95, y: 50 },
  { id: "bottom_left", label: "BL", title: "Bottom Left", x: 5, y: 95 },
  { id: "bottom_center", label: "BC", title: "Bottom Center", x: 50, y: 95 },
  { id: "bottom_right", label: "BR", title: "Bottom Right", x: 95, y: 95 },
] as const;

const SIZE_PRESETS = [
  { label: "Small", value: 10 },
  { label: "Standard", value: 14 },
  { label: "Medium", value: 20 },
  { label: "Large", value: 28 },
  { label: "Full Width", value: 50 },
];

const COLOR_OPTIONS = [
  { id: "original", label: "Original", bg: "bg-gradient-to-tr from-amber-400 via-rose-400 to-indigo-500" },
  { id: "white", label: "White", bg: "bg-white border border-[#d5cbbe]" },
  { id: "gold", label: "Gold", bg: "bg-[#dfa843]" },
  { id: "dark", label: "Dark", bg: "bg-[#181109]" },
] as const;

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

  // Watermark customization state (MADX defaults: right side below middle, 14% size, 40% opacity)
  const [wm, setWm] = useState<WatermarkConfig>({
    imageUrl: null,
    xPercent: 95,
    yPercent: 68,
    sizePercent: 14,
    opacity: 0.40,
    color: "original",
  });

  // Handle clicking on the preview image to position watermark
  function handlePreviewClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const x = Math.max(5, Math.min(95, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.max(5, Math.min(95, Math.round(((e.clientY - rect.top) / rect.height) * 100)));
    setWm((prev) => ({ ...prev, xPercent: x, yPercent: y }));
  }

  function resetDefaults() {
    setWm({
      imageUrl: live.templatePreview || null,
      xPercent: 95,
      yPercent: 68,
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
              <div
                ref={previewRef}
                onClick={handlePreviewClick}
                className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-line bg-black/10 shadow-inner cursor-crosshair select-none group"
              >
                {/* Background Cover Image (User uploaded or Default AI Marriage Couple) */}
                <img
                  src={coverSrc}
                  alt="Event Cover Preview"
                  className="h-full w-full object-cover transition-opacity duration-300"
                />

                {/* Badge indicator on top-left */}
                <div className="absolute top-3 left-3 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-black/70 border border-white/20 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md shadow-sm">
                    {live.preview ? "Custom Cover Image" : "Default AI Couple Photo"}
                  </span>
                  {live.templatePreview && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dfa843]/85 border border-[#dfa843] px-2.5 py-1 text-[11px] font-semibold text-[#1c1305] backdrop-blur-md shadow-sm">
                      <Sparkles className="h-3 w-3" /> Custom Watermark
                    </span>
                  )}
                </div>

                {/* Click to move watermark hint pill */}
                <div className="absolute bottom-3 left-3 rounded-md bg-black/65 border border-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm pointer-events-none flex items-center gap-1.5">
                  <Move className="h-3 w-3 text-brand-300" />
                  <span>Click anywhere on photo to reposition watermark</span>
                </div>

                {/* Live Watermark Overlay Layer */}
                <div
                  style={{
                    position: "absolute",
                    left: `${wm.xPercent}%`,
                    top: `${wm.yPercent}%`,
                    transform: `translate(${wm.xPercent! >= 80 ? "-100%" : wm.xPercent! <= 20 ? "0%" : "-50%"}, ${wm.yPercent! >= 80 ? "-100%" : wm.yPercent! <= 20 ? "0%" : "-50%"})`,
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
                      filter: getFilterCss(wm.color),
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Customization Controls Panel */}
            <div className="p-5 space-y-5">
              {/* Position Controls (place move panra option) */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                    <Move className="h-3.5 w-3.5 text-brand-600" />
                    <span>Watermark Position</span>
                  </label>
                  <span className="text-xs font-mono text-muted">
                    X: {wm.xPercent}% · Y: {wm.yPercent}%
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* 3x3 Mini Grid Presets */}
                  <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-canvas p-1.5">
                    {POS_PRESETS.map((p) => {
                      const isActive =
                        Math.abs((wm.xPercent ?? 95) - p.x) <= 8 &&
                        Math.abs((wm.yPercent ?? 68) - p.y) <= 8;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          title={p.title}
                          onClick={() => setWm((prev) => ({ ...prev, xPercent: p.x, yPercent: p.y }))}
                          className={`h-7 w-8 rounded-md text-[10px] font-bold transition-all ${
                            isActive
                              ? "bg-brand-500 text-ink shadow-sm ring-1 ring-brand-600"
                              : "bg-surface text-muted hover:bg-white hover:text-ink"
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* MADX Signature Default Preset Button */}
                  <button
                    type="button"
                    onClick={() => setWm((prev) => ({ ...prev, xPercent: 95, yPercent: 68 }))}
                    className={`h-11 px-3.5 rounded-xl border text-xs font-semibold transition-all flex items-center gap-2 ${
                      wm.xPercent === 95 && wm.yPercent === 68
                        ? "border-[#dfa843] bg-brand-50 text-brand-900 shadow-sm ring-1 ring-[#dfa843]"
                        : "border-line bg-surface text-muted hover:bg-canvas hover:text-ink"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-[#dfa843]" />
                    <span>MADX Signature (Right Below Mid)</span>
                  </button>
                </div>

                {/* Fine-Tuning Coordinate Sliders */}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted w-14">Horiz (X):</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={wm.xPercent ?? 95}
                      onChange={(e) => setWm((prev) => ({ ...prev, xPercent: Number(e.target.value) }))}
                      className="w-full accent-brand-500 cursor-pointer h-1.5 bg-line rounded-lg"
                    />
                    <span className="text-xs font-mono text-ink w-8 text-right">{wm.xPercent}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted w-14">Vert (Y):</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={wm.yPercent ?? 68}
                      onChange={(e) => setWm((prev) => ({ ...prev, yPercent: Number(e.target.value) }))}
                      className="w-full accent-brand-500 cursor-pointer h-1.5 bg-line rounded-lg"
                    />
                    <span className="text-xs font-mono text-ink w-8 text-right">{wm.yPercent}%</span>
                  </div>
                </div>
              </div>

              {/* Size & Scale Controls (size change panra option) */}
              <div className="pt-2 border-t border-line/60">
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                    <Sliders className="h-3.5 w-3.5 text-brand-600" />
                    <span>Watermark Size</span>
                  </label>
                  <span className="text-xs font-mono font-medium text-ink">{wm.sizePercent}% of photo width</span>
                </div>

                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={6}
                      max={60}
                      step={1}
                      value={wm.sizePercent ?? 14}
                      onChange={(e) => setWm((prev) => ({ ...prev, sizePercent: Number(e.target.value) }))}
                      className="w-full accent-brand-500 cursor-pointer h-2 bg-line rounded-lg"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SIZE_PRESETS.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => setWm((prev) => ({ ...prev, sizePercent: s.value }))}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                          wm.sizePercent === s.value
                            ? "bg-brand-500 text-ink shadow-sm"
                            : "border border-line bg-surface text-muted hover:bg-canvas hover:text-ink"
                        }`}
                      >
                        {s.label} ({s.value}%)
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Color & Opacity Controls (colour change pannra option) */}
              <div className="pt-2 border-t border-line/60 grid gap-4 sm:grid-cols-2">
                {/* Color Scheme */}
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                    <Palette className="h-3.5 w-3.5 text-brand-600" />
                    <span>Watermark Color</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {COLOR_OPTIONS.map((c) => {
                      const isActive = (wm.color || "original") === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setWm((prev) => ({ ...prev, color: c.id }))}
                          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all ${
                            isActive
                              ? "border-brand-500 bg-brand-50 text-ink ring-1 ring-brand-500"
                              : "border-line bg-surface text-muted hover:bg-canvas hover:text-ink"
                          }`}
                        >
                          <span className={`h-3 w-3 rounded-full ${c.bg}`} />
                          <span>{c.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Opacity Slider */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Transparency / Opacity
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
                  <div className="mt-1.5 flex justify-between text-[10px] text-muted">
                    <span>10% (Subtle)</span>
                    <span>40% (Standard)</span>
                    <span>100% (Solid)</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
