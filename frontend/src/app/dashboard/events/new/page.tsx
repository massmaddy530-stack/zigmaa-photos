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
import { EventForm, type TemplateItem } from "@/components/event-form";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { adminApi, errorMessage } from "@/lib/api";
import { fileToDataUrl, saveEventWatermarkConfig, type WatermarkConfig, type WatermarkTemplateItem } from "@/lib/image";

export default function NewEventPage() {
  const router = useRouter();
  const toast = useToast();
  const previewRef = useRef<HTMLDivElement>(null);

  // Top-level single source of truth for templates
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [live, setLive] = useState<{
    name: string;
    date: string;
    venue: string;
    description: string;
    preview: string | null;
  }>({
    name: "",
    date: "",
    venue: "",
    description: "",
    preview: null,
  });

  // Watermark customization state (Zigmaa defaults: bottom-right corner, 14% size, 40% opacity)
  const [wm, setWm] = useState<WatermarkConfig>({
    imageUrl: null,
    xPercent: 88,
    yPercent: 88,
    sizePercent: 14,
    opacity: 0.40,
    color: "original",
  });

  // Active editing template
  const activeEditingId = activeTemplateId || templateItems[0]?.id || null;
  const activeEditingItem = templateItems.find((t) => t.id === activeEditingId) || templateItems[0] || null;

  // Direct positioning function
  function setPosition(xPercent: number, yPercent: number) {
    if (activeEditingItem && templateItems.length > 0) {
      setTemplateItems((prev) =>
        prev.map((t) => (t.id === activeEditingItem.id ? { ...t, xPercent, yPercent } : t))
      );
    }
    setWm((prev) => ({ ...prev, xPercent, yPercent }));
  }

  // Handle clicking anywhere on the preview image to accurately place currently selected watermark
  function handlePreviewClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.max(0, Math.min(100, Math.round(((e.clientY - rect.top) / rect.height) * 100)));

    setPosition(x, y);
  }

  // Direct mouse & touch dragging on photo
  function startDrag(e: React.PointerEvent<HTMLDivElement>, targetId: string) {
    e.stopPropagation();
    e.preventDefault();
    setActiveTemplateId(targetId);
    setDraggingId(targetId);

    const startX = e.clientX;
    const startY = e.clientY;
    const targetItem = templateItems.find((t) => t.id === targetId);
    const startXPercent = targetItem?.xPercent ?? 88;
    const startYPercent = targetItem?.yPercent ?? 88;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dxPct = ((moveEvent.clientX - startX) / rect.width) * 100;
      const dyPct = ((moveEvent.clientY - startY) / rect.height) * 100;

      const newX = Math.max(0, Math.min(100, Math.round(startXPercent + dxPct)));
      const newY = Math.max(0, Math.min(100, Math.round(startYPercent + dyPct)));

      setTemplateItems((prev) =>
        prev.map((t) => (t.id === targetId ? { ...t, xPercent: newX, yPercent: newY } : t))
      );
      setWm((prev) => ({ ...prev, xPercent: newX, yPercent: newY }));
    };

    const onPointerUp = () => {
      setDraggingId(null);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function resetDefaults() {
    const defaultCorners = [
      { x: 88, y: 88 },
      { x: 88, y: 12 },
      { x: 12, y: 12 },
      { x: 12, y: 88 },
      { x: 50, y: 88 },
    ];
    if (templateItems.length > 0) {
      setTemplateItems((prev) =>
        prev.map((t, idx) => ({
          ...t,
          xPercent: defaultCorners[idx % defaultCorners.length].x,
          yPercent: defaultCorners[idx % defaultCorners.length].y,
          sizePercent: 14,
          opacity: 0.40,
          enabled: true,
        }))
      );
    }
    setWm({
      imageUrl: templateItems[0]?.preview || null,
      xPercent: 88,
      yPercent: 88,
      sizePercent: 14,
      opacity: 0.40,
      color: "original",
    });
    toast.success("Reset positions & sizes to defaults");
  }

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
                templateItems={templateItems}
                onTemplateItemsChange={setTemplateItems}
                activeTemplateId={activeTemplateId}
                onSelectTemplate={setActiveTemplateId}
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
                onValuesChange={(vals) => {
                  setLive({
                    name: vals.name,
                    date: vals.date,
                    venue: vals.venue,
                    description: vals.description,
                    preview: vals.preview,
                  });
                }}
                onSubmit={async ({ cover, template, ...values }) => {
                  const ev = await adminApi.createEvent(values);

                  // Convert all uploaded template files to permanent Base64 data URLs
                  const savedTemplates: WatermarkTemplateItem[] = [];

                  for (const item of templateItems) {
                    try {
                      const dataUrl = await fileToDataUrl(item.file);
                      savedTemplates.push({
                        id: item.id,
                        name: item.name,
                        sizeBytes: item.size,
                        dataUrl,
                        xPercent: item.xPercent ?? 88,
                        yPercent: item.yPercent ?? 88,
                        sizePercent: item.sizePercent ?? 14,
                        opacity: item.opacity ?? 0.40,
                        enabled: item.enabled !== false,
                        color: wm.color ?? "original",
                      });
                    } catch (e) {
                      console.warn("Could not convert template to data URL", e);
                    }
                  }

                  const activeId = activeTemplateId || savedTemplates[0]?.id;
                  const activeSaved = savedTemplates.find((t) => t.id === activeId) || savedTemplates[0];

                  let activeDataUrl = activeSaved?.dataUrl || null;
                  if (!activeDataUrl && template) {
                    try {
                      activeDataUrl = await fileToDataUrl(template);
                    } catch {}
                  }

                  // Persist watermark configuration for this event and as studio default
                  const finalConfig: WatermarkConfig = {
                    ...wm,
                    imageUrl: activeDataUrl || wm.imageUrl || null,
                    templates: savedTemplates.length > 0 ? savedTemplates : undefined,
                    activeTemplateId: activeSaved?.id || null,
                  };

                  saveEventWatermarkConfig(ev.id, ev.slug, finalConfig);

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
                    title="Reset to Zigmaa defaults"
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:bg-canvas hover:text-ink transition-colors"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset
                  </button>
                </div>
              }
            />

            {/* Interactive Preview Canvas - Clean, uncropped photo */}
            <div className="p-5 pb-0 flex items-center justify-center">
              <div
                ref={previewRef}
                onClick={handlePreviewClick}
                className="relative inline-block max-h-[620px] max-w-full overflow-hidden rounded-2xl border border-line shadow-md cursor-crosshair select-none group bg-canvas"
              >
                {/* Background Cover Image (User uploaded or Default AI Marriage Couple) */}
                <img
                  src={coverSrc}
                  alt="Event Cover Preview"
                  className="max-h-[620px] w-auto max-w-full block object-contain mx-auto transition-opacity duration-300"
                />

                {/* Badge indicator on top-left of photo */}
                <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-black/75 border border-white/20 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md shadow-md">
                    {live.preview ? "Custom Cover Image" : "Default AI Couple Photo"}
                  </span>
                  {templateItems.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dfa843]/90 border border-[#dfa843] px-2.5 py-1 text-[11px] font-semibold text-[#1c1305] backdrop-blur-md shadow-md">
                      <Sparkles className="h-3 w-3" /> Custom Watermark ({templateItems.filter((t) => t.enabled !== false).length})
                    </span>
                  )}
                </div>

                {/* Click / Drag hint pill */}
                <div className="absolute bottom-3 left-3 rounded-md bg-black/75 border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md pointer-events-none flex items-center gap-1.5 shadow-md">
                  <Move className="h-3 w-3 text-brand-300" />
                  <span>Drag watermark or click photo to reposition</span>
                </div>

                {/* Live Watermark Overlay Layer - ALL Enabled Templates Visible at the Same Time! */}
                {templateItems.length > 0 ? (
                  templateItems.map((t) => {
                    if (t.enabled === false) return null;
                    const isEditing = t.id === activeEditingId;
                    const xPct = t.xPercent ?? 88;
                    const yPct = t.yPercent ?? 88;
                    const sizePct = t.sizePercent ?? 14;
                    const opVal = t.opacity ?? 0.40;

                    return (
                      <div
                        key={t.id}
                        onPointerDown={(e) => startDrag(e, t.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveTemplateId(t.id);
                        }}
                        style={{
                          position: "absolute",
                          left: `${xPct}%`,
                          top: `${yPct}%`,
                          transform: `translate(-${xPct}%, -${yPct}%)`,
                          width: `${sizePct}%`,
                          opacity: opVal,
                          cursor: draggingId === t.id ? "grabbing" : "grab",
                          touchAction: "none",
                          userSelect: "none",
                        }}
                        className={`transition-opacity duration-150 select-none ${
                          isEditing ? "ring-1 ring-white/50 rounded" : ""
                        }`}
                        title={`Drag to reposition "${t.name}" or select to edit`}
                      >
                        <img
                          src={t.preview}
                          alt={t.name}
                          draggable={false}
                          style={{
                            width: "100%",
                            height: "auto",
                            display: "block",
                            filter: getFilterCss(wm.color),
                            pointerEvents: "none",
                          }}
                        />
                      </div>
                    );
                  })
                ) : (
                  <div
                    style={{
                      position: "absolute",
                      left: `${wm.xPercent}%`,
                      top: `${wm.yPercent}%`,
                      transform: `translate(-${wm.xPercent}%, -${wm.yPercent}%)`,
                      width: `${wm.sizePercent}%`,
                      opacity: wm.opacity,
                      pointerEvents: "none",
                      transition: "opacity 0.15s ease",
                    }}
                  >
                    <img
                      src="/watermark.png"
                      alt="Watermark Overlay"
                      style={{
                        width: "100%",
                        height: "auto",
                        display: "block",
                        filter: getFilterCss(wm.color),
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Template Selector Bar (When templates are uploaded) */}
            {templateItems.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-b border-line bg-canvas/30">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-muted shrink-0">
                    Templates ({templateItems.filter((t) => t.enabled !== false).length}/{templateItems.length}):
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {templateItems.map((t) => {
                      const isEditing = t.id === activeEditingId;
                      const isEnabled = t.enabled !== false;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setActiveTemplateId(t.id)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all cursor-pointer ${
                            isEditing
                              ? "border-brand-500 bg-brand-50 text-brand-700 font-semibold ring-1 ring-brand-500 shadow-xs"
                              : "border-line bg-surface text-ink hover:bg-canvas"
                          }`}
                        >
                          <div className="h-4 w-4 shrink-0 rounded bg-[repeating-conic-gradient(#e8e4dc_0%_25%,#fdfbf7_0%_50%)] bg-[length:4px_4px] p-0.5 flex items-center justify-center overflow-hidden">
                            <img src={t.preview} alt="" className="max-h-full max-w-full object-contain" />
                          </div>
                          <span className={`truncate max-w-[120px] ${!isEnabled ? "line-through opacity-50" : ""}`}>
                            {t.name}
                          </span>
                          {isEditing && (
                            <span className="text-[10px] text-brand-600 font-bold shrink-0">(Active)</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <span className="text-[11px] text-muted hidden sm:inline">
                  Drag watermark or click buttons to position
                </span>
              </div>
            )}

            {/* Customization Controls Panel */}
            <div className="p-5 space-y-4">
              {/* 1-Click Quick Corner Placement buttons */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                    <Move className="h-3.5 w-3.5 text-brand-600" />
                    <span>Quick Position {activeEditingItem ? `(${activeEditingItem.name})` : ""}</span>
                  </label>
                  <span className="text-[11px] text-muted">
                    X: {activeEditingItem?.xPercent ?? wm.xPercent}%, Y: {activeEditingItem?.yPercent ?? wm.yPercent}%
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  <button
                    type="button"
                    onClick={() => setPosition(12, 12)}
                    className="flex items-center justify-center gap-1 rounded-lg border border-line bg-surface py-1.5 text-xs font-medium text-ink hover:border-brand-300 hover:bg-brand-50/50 transition-colors cursor-pointer"
                    title="Top Left"
                  >
                    ↖ Top-L
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosition(88, 12)}
                    className="flex items-center justify-center gap-1 rounded-lg border border-line bg-surface py-1.5 text-xs font-medium text-ink hover:border-brand-300 hover:bg-brand-50/50 transition-colors cursor-pointer"
                    title="Top Right"
                  >
                    ↗ Top-R
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosition(50, 50)}
                    className="flex items-center justify-center gap-1 rounded-lg border border-line bg-surface py-1.5 text-xs font-medium text-ink hover:border-brand-300 hover:bg-brand-50/50 transition-colors cursor-pointer"
                    title="Center"
                  >
                    ⦿ Center
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosition(12, 88)}
                    className="flex items-center justify-center gap-1 rounded-lg border border-line bg-surface py-1.5 text-xs font-medium text-ink hover:border-brand-300 hover:bg-brand-50/50 transition-colors cursor-pointer"
                    title="Bottom Left"
                  >
                    ↙ Btm-L
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosition(88, 88)}
                    className="flex items-center justify-center gap-1 rounded-lg border border-line bg-surface py-1.5 text-xs font-medium text-ink hover:border-brand-300 hover:bg-brand-50/50 transition-colors cursor-pointer"
                    title="Bottom Right (Default)"
                  >
                    ↘ Btm-R
                  </button>
                </div>
              </div>

              {/* Sliders: Size & Transparency */}
              <div className="grid gap-5 sm:grid-cols-2 pt-1">
                {/* Size & Scale Control */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                      <Sliders className="h-3.5 w-3.5 text-brand-600" />
                      <span>Watermark Size {activeEditingItem ? `(${activeEditingItem.name})` : ""}</span>
                    </label>
                    <span className="text-xs font-mono font-medium text-ink">
                      {activeEditingItem?.sizePercent ?? wm.sizePercent ?? 14}% of photo width
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    step={1}
                    value={activeEditingItem?.sizePercent ?? wm.sizePercent ?? 14}
                    onChange={(e) => {
                      const newSize = Number(e.target.value);
                      if (activeEditingItem) {
                        setTemplateItems((prev) =>
                          prev.map((t) =>
                            t.id === activeEditingItem.id ? { ...t, sizePercent: newSize } : t
                          )
                        );
                      }
                      setWm((prev) => ({ ...prev, sizePercent: newSize }));
                    }}
                    className="w-full accent-brand-500 cursor-pointer h-2 bg-line rounded-lg mt-2"
                  />
                </div>

                {/* Transparency / Opacity Control */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-brand-600" />
                      <span>Transparency / Opacity {activeEditingItem ? `(${activeEditingItem.name})` : ""}</span>
                    </label>
                    <span className="text-xs font-mono font-medium text-ink">
                      {Math.round((activeEditingItem?.opacity ?? wm.opacity ?? 0.40) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.05}
                    max={1.0}
                    step={0.05}
                    value={activeEditingItem?.opacity ?? wm.opacity ?? 0.40}
                    onChange={(e) => {
                      const newOpacity = Number(e.target.value);
                      if (activeEditingItem) {
                        setTemplateItems((prev) =>
                          prev.map((t) =>
                            t.id === activeEditingItem.id ? { ...t, opacity: newOpacity } : t
                          )
                        );
                      }
                      setWm((prev) => ({ ...prev, opacity: newOpacity }));
                    }}
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
