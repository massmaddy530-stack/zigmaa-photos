"use client";

import { useRouter } from "next/navigation";
import { Eye, EyeOff, ImagePlus, Move, Palette, RotateCcw, RotateCw, Sliders, Sparkles, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { adminApi, errorMessage } from "@/lib/api";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_MB } from "@/lib/config";
import { formatNumber } from "@/lib/format";
import { getSavedWatermarkConfig, optimizeWatermarkFile, saveEventWatermarkConfig, type WatermarkConfig, type WatermarkTemplateItem } from "@/lib/image";
import type { EventOut } from "@/lib/types";
import { CoverImage } from "./event-card";
import { EventForm } from "./event-form";
import { TemplateDesignerModal, type GeneratedTemplateResult } from "./template-designer-modal";
import { WatermarkOverlayBox } from "./watermark-overlay-box";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/modal";
import { Card, CardHeader, Field, Input } from "./ui/primitives";
import { useToast } from "./ui/toast";

export function EventSettings({ event, onSaved }: { event: EventOut; onSaved: (e: EventOut) => void }) {
  const router = useRouter();
  const toast = useToast();
  const coverRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const [coverBusy, setCoverBusy] = useState(false);
  const [dialog, setDialog] = useState<"purge" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [showDesigner, setShowDesigner] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMountRef = useRef(true);
  const loadedFromServerRef = useRef(false);

  // Load existing watermark configuration or defaults
  const [wm, setWm] = useState<WatermarkConfig>(() => {
    return (
      getSavedWatermarkConfig(event.id) ||
      getSavedWatermarkConfig(event.slug) ||
      getSavedWatermarkConfig() || {
        imageUrl: null,
        xPercent: 88,
        yPercent: 88,
        sizePercent: 14,
        opacity: 0.4,
        color: "original",
      }
    );
  });

  // Fetch persisted watermark configuration from the server
  useEffect(() => {
    void fetch(`/api/watermark?eventId=${encodeURIComponent(event.id)}&slug=${encodeURIComponent(event.slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        loadedFromServerRef.current = true;
        if (data?.config && typeof data.config === "object") {
          setWm(data.config);
          saveEventWatermarkConfig(event.id, event.slug, data.config);
        }
      })
      .catch(() => {
        loadedFromServerRef.current = true;
      });
  }, [event.id, event.slug]);

  // Debounced auto-save: ensures every slider, drag, and position change is persisted automatically
  useEffect(() => {
    // Avoid overwriting database watermark on initial mount before server config has loaded
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    const hasCustomWatermark = Boolean(
      (Array.isArray(wm.templates) && wm.templates.some((t) => Boolean(t.dataUrl))) || wm.imageUrl
    );
    // Don't save empty config unless we are certain the user explicitly cleared it after loading
    if (!hasCustomWatermark && !loadedFromServerRef.current) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveEventWatermarkConfig(event.id, event.slug, wm);
    }, 400);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [wm, event.id, event.slug]);

  async function changeCover(f: File | undefined) {
    if (!f) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(f.type) || f.size > MAX_UPLOAD_MB * 1024 * 1024) {
      toast.error("Unsupported image", `Use JPEG, PNG or WebP under ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    setCoverBusy(true);
    try {
      onSaved(await adminApi.uploadCover(event.id, f, f.name));
      toast.success("Cover updated");
    } catch (err) {
      toast.error("Cover upload failed", errorMessage(err));
    } finally {
      setCoverBusy(false);
    }
  }

  async function addTemplates(files: FileList | null) {
    if (!files || files.length === 0) return;
    const allowed = ["image/png", "image/svg+xml", "image/webp", "image/jpeg"];
    const newItems: WatermarkTemplateItem[] = [];

    const defaultCorners = [
      { x: 88, y: 88 },
      { x: 88, y: 12 },
      { x: 12, y: 12 },
      { x: 12, y: 88 },
      { x: 50, y: 88 },
    ];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!allowed.includes(f.type)) {
        toast.error("Unsupported file", `${f.name}: Use PNG, SVG, WebP or JPEG.`);
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error("File too large", `${f.name}: Must be under 10 MB.`);
        continue;
      }
      try {
        const dataUrl = await optimizeWatermarkFile(f);
        const existingCount = (wm.templates || []).length + newItems.length;
        const corner = defaultCorners[existingCount % defaultCorners.length];
        newItems.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${f.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`,
          name: f.name,
          sizeBytes: f.size,
          dataUrl,
          xPercent: corner.x,
          yPercent: corner.y,
          sizePercent: 16,
          opacity: 0.70,
          enabled: true,
        });
      } catch {
        toast.error("Could not read template file", f.name);
      }
    }

    if (newItems.length > 0) {
      setWm((prev) => {
        // Keep all existing templates enabled so multiple watermarks are active together!
        const existing = (prev.templates || []).map((t) => ({ ...t, enabled: t.enabled !== false }));
        const updated = [...existing, ...newItems];
        const active = updated[updated.length - 1]; // select the newest uploaded template
        const next: WatermarkConfig = {
          ...prev,
          templates: updated,
          activeTemplateId: active.id,
          imageUrl: active.dataUrl,
          sizePercent: active.sizePercent ?? 16,
          opacity: active.opacity ?? 0.70,
          xPercent: active.xPercent ?? 88,
          yPercent: active.yPercent ?? 88,
        };
        saveEventWatermarkConfig(event.id, event.slug, next);
        return next;
      });
      toast.success(
        newItems.length > 1 ? `${newItems.length} templates uploaded` : "Watermark uploaded & applied!",
        "Active on photo downloads with custom position, scale and opacity."
      );
    }
  }

  function selectTemplate(item: WatermarkTemplateItem) {
    setWm((prev) => {
      // Keep ALL templates enabled - only switch which template is active for editing!
      const activeItem = (prev.templates || []).find((t) => t.id === item.id) || item;
      const next: WatermarkConfig = {
        ...prev,
        activeTemplateId: item.id,
        imageUrl: activeItem.dataUrl,
        sizePercent: activeItem.sizePercent ?? 16,
        opacity: activeItem.opacity ?? 0.70,
        xPercent: activeItem.xPercent ?? 88,
        yPercent: activeItem.yPercent ?? 88,
      };
      saveEventWatermarkConfig(event.id, event.slug, next);
      return next;
    });
  }

  function toggleTemplateEnabled(id: string) {
    setWm((prev) => {
      const updated = (prev.templates || []).map((t) =>
        t.id === id ? { ...t, enabled: t.enabled === false ? true : false } : t
      );
      const next: WatermarkConfig = { ...prev, templates: updated };
      saveEventWatermarkConfig(event.id, event.slug, next);
      return next;
    });
  }

  function removeTemplateItem(id: string) {
    setWm((prev) => {
      const updated = (prev.templates || []).filter((t) => t.id !== id);
      const nextActive = updated[0];
      const next: WatermarkConfig = {
        ...prev,
        templates: updated,
        activeTemplateId: nextActive?.id || null,
        imageUrl: nextActive?.dataUrl || null,
        sizePercent: nextActive?.sizePercent ?? prev.sizePercent ?? 16,
        opacity: nextActive?.opacity ?? prev.opacity ?? 0.70,
        xPercent: nextActive?.xPercent ?? prev.xPercent ?? 88,
        yPercent: nextActive?.yPercent ?? prev.yPercent ?? 88,
      };
      saveEventWatermarkConfig(event.id, event.slug, next);
      return next;
    });
  }

  function resetTemplates() {
    const next: WatermarkConfig = {
      imageUrl: null,
      templates: [],
      activeTemplateId: null,
      xPercent: 88,
      yPercent: 88,
      sizePercent: 14,
      opacity: 0.40,
      color: "original",
    };
    setWm(next);
    saveEventWatermarkConfig(event.id, event.slug, next);
    toast.success("Reset to default Zigmaa logo");
  }

  function handleApplyAiTemplate(res: GeneratedTemplateResult) {
    const newItem: WatermarkTemplateItem = {
      id: res.id,
      name: res.name,
      sizeBytes: res.sizeBytes,
      dataUrl: res.dataUrl,
      xPercent: res.xPercent,
      yPercent: res.yPercent,
      sizePercent: res.sizePercent,
      opacity: res.opacity,
      enabled: true,
      color: "original",
    };
    setWm((prev) => {
      const existing = (prev.templates || []).map((t) => ({ ...t, enabled: t.enabled !== false }));
      const updated = [...existing, newItem];
      const next: WatermarkConfig = {
        ...prev,
        templates: updated,
        activeTemplateId: newItem.id,
        imageUrl: newItem.dataUrl,
        sizePercent: newItem.sizePercent,
        opacity: newItem.opacity,
        xPercent: newItem.xPercent,
        yPercent: newItem.yPercent,
      };
      saveEventWatermarkConfig(event.id, event.slug, next);
      return next;
    });
    toast.success("AI Template applied & saved!", "Applied to all photo downloads.");
  }

  function setPosition(xPercent: number, yPercent: number) {
    if (wm.templates && wm.templates.length > 0) {
      const activeId = wm.activeTemplateId || wm.templates[0].id;
      setWm((prev) => ({
        ...prev,
        xPercent,
        yPercent,
        templates: (prev.templates || []).map((t) =>
          t.id === activeId ? { ...t, xPercent, yPercent } : t
        ),
      }));
    } else {
      setWm((prev) => ({ ...prev, xPercent, yPercent }));
    }
  }

  function handlePreviewClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.max(0, Math.min(100, Math.round(((e.clientY - rect.top) / rect.height) * 100)));

    setPosition(x, y);
  }

  function startDrag(e: React.PointerEvent, targetId: string) {
    e.stopPropagation();
    e.preventDefault();
    setDraggingId(targetId);

    const target = (wm.templates || []).find((t) => t.id === targetId);
    if (target) {
      selectTemplate(target);
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const startXPercent = target?.xPercent ?? wm.xPercent ?? 88;
    const startYPercent = target?.yPercent ?? wm.yPercent ?? 88;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dxPct = ((moveEvent.clientX - startX) / rect.width) * 100;
      const dyPct = ((moveEvent.clientY - startY) / rect.height) * 100;

      const newX = Math.max(0, Math.min(100, Math.round(startXPercent + dxPct)));
      const newY = Math.max(0, Math.min(100, Math.round(startYPercent + dyPct)));

      setWm((prev) => ({
        ...prev,
        xPercent: newX,
        yPercent: newY,
        templates: (prev.templates || []).map((t) =>
          t.id === targetId ? { ...t, xPercent: newX, yPercent: newY } : t
        ),
      }));
    };

    const onPointerUp = () => {
      setDraggingId(null);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  async function saveWatermark() {
    saveEventWatermarkConfig(event.id, event.slug, wm);
    try {
      await fetch("/api/watermark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id, slug: event.slug, config: wm }),
      });
    } catch (e) {
      console.warn("Could not sync watermark to server", e);
    }
    toast.success("Watermark template saved", "Applied to all photo downloads for this event across all devices.");
  }

  async function purgeFaces() {
    setBusy(true);
    try {
      const r = await adminApi.purgeFaces(event.id);
      toast.success("Face data deleted", `${formatNumber(r.deleted_faces)} face embeddings removed. Guest search is now disabled for these photos.`);
      setDialog(null);
      onSaved(await adminApi.getEvent(event.id));
    } catch (err) {
      toast.error("Couldn't delete face data", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteEvent() {
    setBusy(true);
    try {
      await adminApi.deleteEvent(event.id);
      toast.success("Event deleted");
      router.replace("/dashboard/events");
    } catch (err) {
      toast.error("Couldn't delete event", errorMessage(err));
      setBusy(false);
    }
  }

  const activeTemplateItem = wm.templates?.find(
    (t) => t.id === (wm.activeTemplateId || wm.templates?.[0]?.id)
  );
  const rawOpacity = activeTemplateItem?.opacity ?? wm.opacity ?? 0.70;
  const safeOpacity = rawOpacity > 1 ? rawOpacity / 100 : rawOpacity;
  const safeSize = activeTemplateItem?.sizePercent ?? wm.sizePercent ?? 100;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-12 items-stretch">
        {/* Left Column: Event information, Cover image, and Templates / Watermark overlays (6 cols) */}
        <div className="space-y-6 lg:col-span-6 xl:col-span-6 flex flex-col">
          {/* 1. Event Information Form */}
          <Card>
            <CardHeader title="Event information" description="Basic information about your photoshoot event." />
            <div className="p-5">
              <EventForm
                initial={event}
                withCover={false}
                submitLabel="Save changes"
                onSubmit={async ({ name, event_date, venue, description }) => {
                  onSaved(await adminApi.updateEvent(event.id, { name, event_date, venue, description }));
                  toast.success("Changes saved");
                }}
              />
            </div>
          </Card>

          {/* 2. Cover Image Card */}
          <Card>
            <CardHeader title="Cover image" description="Event cover photo shown on guest gallery and watermark preview" />
            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-line bg-canvas">
                  <CoverImage
                    src={event.cover_url}
                    name={event.name}
                    className="h-full w-full"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {event.cover_url ? "Cover photo uploaded" : "No cover photo yet"}
                  </p>
                  <p className="text-xs text-muted">Shown at the top of the guest page</p>
                </div>
              </div>
              <input
                ref={coverRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(",")}
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  void changeCover(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                loading={coverBusy}
                onClick={() => coverRef.current?.click()}
                icon={<ImagePlus className="h-4 w-4" />}
              >
                {event.cover_url ? "Replace cover" : "Add cover"}
              </Button>
            </div>
          </Card>

          {/* 3. Templates / Watermark Overlays Card */}
          <Card>
            <CardHeader
              title="Templates / Watermark overlays"
              description="Manage attached vector templates and watermark overlays"
              action={
                wm.templates && wm.templates.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resetTemplates}
                    icon={<RotateCcw className="h-3 w-3" />}
                    className="h-7 text-xs px-2.5"
                    title="Clear custom templates and restore default logo"
                  >
                    Reset defaults
                  </Button>
                ) : undefined
              }
            />
            <div className="space-y-3 p-5">
              <input
                ref={templateRef}
                type="file"
                multiple
                accept="image/png,image/svg+xml,image/webp,image/jpeg"
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  void addTemplates(e.target.files);
                  e.target.value = "";
                }}
              />

              {wm.templates && wm.templates.length > 0 ? (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-1 gap-2 max-h-[240px] overflow-y-auto p-0.5">
                    {wm.templates.map((t) => {
                      const isActive = t.id === (wm.activeTemplateId || wm.templates![0]?.id);
                      const isEnabled = t.enabled !== false;
                      return (
                        <div
                          key={t.id}
                          onClick={() => selectTemplate(t)}
                          className={`relative flex items-center justify-between gap-2.5 rounded-xl border p-2.5 transition-all cursor-pointer select-none ${
                            isActive
                              ? "border-brand-500 bg-brand-50/40 ring-1 ring-brand-500 shadow-xs"
                              : "border-line bg-surface hover:border-brand-300 hover:bg-canvas/50"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="h-9 w-9 shrink-0 rounded-lg border border-line bg-[repeating-conic-gradient(#e8e4dc_0%_25%,#fdfbf7_0%_50%)] bg-[length:8px_8px] p-0.5 flex items-center justify-center overflow-hidden">
                              <img src={t.dataUrl} alt={t.name} className="max-h-full max-w-full object-contain" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <p className={`truncate text-xs font-semibold text-ink ${!isEnabled ? "line-through opacity-50" : ""}`}>
                                  {t.name}
                                </p>
                                {isActive && (
                                  <span className="shrink-0 rounded-full bg-brand-100 px-1.5 py-0.2 text-[9px] font-semibold text-brand-700">
                                    Active
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted">
                                {t.sizeBytes ? `${(t.sizeBytes / 1024).toFixed(1)} KB • ` : ""}
                                {isEnabled ? "Visible" : "Hidden"}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTemplateEnabled(t.id);
                              }}
                              aria-label={isEnabled ? "Hide from photo" : "Show on photo"}
                              className={`grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors ${
                                isEnabled ? "text-brand-600 hover:bg-brand-50" : "text-muted hover:bg-canvas hover:text-ink"
                              }`}
                              title={isEnabled ? "Visible on photo" : "Hidden - click to show"}
                            >
                              {isEnabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeTemplateItem(t.id);
                              }}
                              aria-label={`Remove ${t.name}`}
                              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                              title="Remove template"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs font-semibold text-ink"
                      onClick={() => setShowDesigner(true)}
                      icon={<Palette className="h-4 w-4 text-brand-600" />}
                    >
                      Customize Template / Watermark
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => templateRef.current?.click()}
                      icon={<Upload className="h-4 w-4" />}
                    >
                      + Upload Template / Watermark
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    className="text-xs font-semibold text-ink py-4 h-auto flex flex-col gap-1"
                    onClick={() => setShowDesigner(true)}
                    icon={<Palette className="h-5 w-5 text-brand-600" />}
                  >
                    <span className="font-bold text-sm">Customize Template / Watermark</span>
                    <span className="text-[11px] font-normal text-muted">Create or edit banner watermark</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-xs py-4 h-auto flex flex-col gap-1 border-dashed"
                    onClick={() => templateRef.current?.click()}
                    icon={<ImagePlus className="h-5 w-5 text-brand-600" />}
                  >
                    <span className="font-medium text-brand-700">Upload Template / Watermark</span>
                    <span className="text-[11px] text-muted">PNG, SVG with transparency</span>
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Live Watermark Studio & Customization Controls (6 cols) */}
        <div className="space-y-6 lg:col-span-6 xl:col-span-6 lg:sticky lg:top-6 self-start">
          <Card className="overflow-hidden">
            <CardHeader
              title="Watermark & Template Studio"
              description="Live preview of how your watermark will appear on downloaded photos"
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resetTemplates}
                  icon={<RotateCcw className="h-3.5 w-3.5" />}
                  title="Reset to defaults"
                >
                  Reset
                </Button>
              }
            />
            <div className="space-y-4 p-5">
            {/* Live Watermark Preview on Event Cover - Tightly wrapped around photo so coordinates match 100% */}
            <div
              className="relative mx-auto min-h-[260px] max-h-[460px] w-full overflow-hidden rounded-xl border border-line bg-canvas flex items-center justify-center select-none shadow-sm p-2"
            >
              <div
                ref={previewRef}
                onClick={handlePreviewClick}
                className="relative inline-block max-h-[440px] max-w-full cursor-crosshair"
              >
                <img
                  src={event.cover_url || "/default-cover.jpg"}
                  alt="Cover Preview"
                  className="max-h-[440px] w-auto max-w-full object-contain block mx-auto pointer-events-none select-none rounded"
                />
                {/* All Enabled Watermarks Rendered Simultaneously on the exact photo bounds */}
                {wm.templates && wm.templates.length > 0 ? (
                  wm.templates.map((t) => {
                    if (t.enabled === false) return null;
                    const isEditing = t.id === (wm.activeTemplateId || wm.templates![0]?.id);
                    const xPct = isEditing ? (wm.xPercent ?? t.xPercent ?? 88) : (t.xPercent ?? 88);
                    const yPct = isEditing ? (wm.yPercent ?? t.yPercent ?? 88) : (t.yPercent ?? 88);
                    const sizePct = isEditing ? (wm.sizePercent ?? t.sizePercent ?? 14) : (t.sizePercent ?? 14);
                    const heightPct = isEditing ? (wm.heightPercent ?? t.heightPercent) : t.heightPercent;
                    const rotDeg = isEditing ? (wm.rotation ?? t.rotation ?? 0) : (t.rotation ?? 0);
                    const opVal = isEditing ? (wm.opacity ?? t.opacity ?? 0.40) : (t.opacity ?? 0.40);

                    return (
                      <WatermarkOverlayBox
                        key={t.id}
                        src={t.dataUrl}
                        alt={t.name}
                        isEditing={isEditing}
                        isDragging={draggingId === t.id}
                        xPercent={xPct}
                        yPercent={yPct}
                        sizePercent={sizePct}
                        heightPercent={heightPct}
                        rotation={rotDeg}
                        opacity={opVal}
                        previewRef={previewRef}
                        onSelect={() => selectTemplate(t)}
                        onStartDrag={(e) => startDrag(e, t.id)}
                        onTransformChange={(patch) => {
                          setWm((prev) => {
                            const next = {
                              ...prev,
                              ...patch,
                              templates: (prev.templates || []).map((item) =>
                                item.id === t.id ? { ...item, ...patch } : item
                              ),
                            };
                            saveEventWatermarkConfig(event.id, event.slug, next);
                            return next;
                          });
                        }}
                        title={`Drag to move "${t.name}", use arrows to resize width/height, or top handle to rotate`}
                      />
                    );
                  })
                ) : (
                  <WatermarkOverlayBox
                    src={wm.imageUrl || "/watermark.png"}
                    alt="Watermark"
                    isEditing={true}
                    isDragging={draggingId === "default"}
                    xPercent={wm.xPercent ?? 88}
                    yPercent={wm.yPercent ?? 88}
                    sizePercent={wm.sizePercent ?? 14}
                    heightPercent={wm.heightPercent}
                    rotation={wm.rotation ?? 0}
                    opacity={wm.opacity ?? 0.40}
                    previewRef={previewRef}
                    onStartDrag={(e) => startDrag(e, "default")}
                    onTransformChange={(patch) => {
                      setWm((prev) => {
                        const next = { ...prev, ...patch };
                        saveEventWatermarkConfig(event.id, event.slug, next);
                        return next;
                      });
                    }}
                    title="Drag to move, use arrows to resize width/height, or top handle to rotate"
                  />
                )}
              </div>
            </div>

            {/* Quick Corner Placement */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-wider text-muted flex items-center gap-1">
                  <Move className="h-3 w-3 text-brand-600" /> Quick Position
                </span>
                <span className="text-[11px] text-muted">
                  X: {activeTemplateItem?.xPercent ?? wm.xPercent ?? 88}%, Y: {activeTemplateItem?.yPercent ?? wm.yPercent ?? 88}%
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                <button
                  type="button"
                  onClick={() => setPosition(12, 12)}
                  className="rounded-lg border border-line bg-surface py-1 text-xs font-medium text-ink hover:border-brand-300 hover:bg-brand-50/50 transition-colors text-center cursor-pointer"
                  title="Top Left"
                >
                  ↖ Top-L
                </button>
                <button
                  type="button"
                  onClick={() => setPosition(88, 12)}
                  className="rounded-lg border border-line bg-surface py-1 text-xs font-medium text-ink hover:border-brand-300 hover:bg-brand-50/50 transition-colors text-center cursor-pointer"
                  title="Top Right"
                >
                  ↗ Top-R
                </button>
                <button
                  type="button"
                  onClick={() => setPosition(50, 50)}
                  className="rounded-lg border border-line bg-surface py-1 text-xs font-medium text-ink hover:border-brand-300 hover:bg-brand-50/50 transition-colors text-center cursor-pointer"
                  title="Center"
                >
                  ⦿ Center
                </button>
                <button
                  type="button"
                  onClick={() => setPosition(12, 88)}
                  className="rounded-lg border border-line bg-surface py-1 text-xs font-medium text-ink hover:border-brand-300 hover:bg-brand-50/50 transition-colors text-center cursor-pointer"
                  title="Bottom Left"
                >
                  ↙ Btm-L
                </button>
                <button
                  type="button"
                  onClick={() => setPosition(88, 88)}
                  className="rounded-lg border border-line bg-surface py-1 text-xs font-medium text-ink hover:border-brand-300 hover:bg-brand-50/50 transition-colors text-center cursor-pointer"
                  title="Bottom Right (Default)"
                >
                  ↘ Btm-R
                </button>
              </div>
            </div>

            {/* Width & Height Sliders */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-semibold uppercase tracking-wider text-muted flex items-center gap-1">
                    <Sliders className="h-3 w-3 text-brand-600" /> Width{" "}
                    {activeTemplateItem ? `(${activeTemplateItem.name})` : ""}
                  </span>
                  <span className="font-mono font-medium text-ink">
                    {safeSize}%
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={1}
                  value={safeSize}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const activeId = wm.activeTemplateId || wm.templates?.[0]?.id;
                    setWm((prev) => {
                      const next = {
                        ...prev,
                        sizePercent: val,
                        templates: (prev.templates || []).map((t) =>
                          t.id === activeId ? { ...t, sizePercent: val } : t
                        ),
                      };
                      saveEventWatermarkConfig(event.id, event.slug, next);
                      return next;
                    });
                  }}
                  className="w-full accent-brand-500 cursor-pointer h-1.5 bg-line rounded-lg"
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-semibold uppercase tracking-wider text-muted flex items-center gap-1">
                    <Sliders className="h-3 w-3 text-brand-600" /> Height
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-ink">
                      {(activeTemplateItem?.heightPercent ?? wm.heightPercent ?? 0) > 0
                        ? `${activeTemplateItem?.heightPercent ?? wm.heightPercent}%`
                        : "Auto"}
                    </span>
                    {(activeTemplateItem?.heightPercent ?? wm.heightPercent ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const activeId = wm.activeTemplateId || wm.templates?.[0]?.id;
                          setWm((prev) => {
                            const next = {
                              ...prev,
                              heightPercent: undefined,
                              templates: (prev.templates || []).map((t) =>
                                t.id === activeId ? { ...t, heightPercent: undefined } : t
                              ),
                            };
                            saveEventWatermarkConfig(event.id, event.slug, next);
                            return next;
                          });
                        }}
                        className="text-[10px] text-brand-600 hover:underline cursor-pointer"
                      >
                        Auto
                      </button>
                    )}
                  </div>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={1}
                  value={activeTemplateItem?.heightPercent ?? wm.heightPercent ?? 20}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const activeId = wm.activeTemplateId || wm.templates?.[0]?.id;
                    setWm((prev) => {
                      const next = {
                        ...prev,
                        heightPercent: val,
                        templates: (prev.templates || []).map((t) =>
                          t.id === activeId ? { ...t, heightPercent: val } : t
                        ),
                      };
                      saveEventWatermarkConfig(event.id, event.slug, next);
                      return next;
                    });
                  }}
                  className="w-full accent-brand-500 cursor-pointer h-1.5 bg-line rounded-lg"
                />
              </div>
            </div>

            {/* Rotation & Opacity Sliders */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-semibold uppercase tracking-wider text-muted flex items-center gap-1">
                    <RotateCw className="h-3 w-3 text-brand-600" /> Rotate
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-ink">
                      {activeTemplateItem?.rotation ?? wm.rotation ?? 0}°
                    </span>
                    {(activeTemplateItem?.rotation ?? wm.rotation ?? 0) !== 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const activeId = wm.activeTemplateId || wm.templates?.[0]?.id;
                          setWm((prev) => {
                            const next = {
                              ...prev,
                              rotation: 0,
                              templates: (prev.templates || []).map((t) =>
                                t.id === activeId ? { ...t, rotation: 0 } : t
                              ),
                            };
                            saveEventWatermarkConfig(event.id, event.slug, next);
                            return next;
                          });
                        }}
                        className="text-[10px] text-brand-600 hover:underline cursor-pointer"
                      >
                        0°
                      </button>
                    )}
                  </div>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={activeTemplateItem?.rotation ?? wm.rotation ?? 0}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const activeId = wm.activeTemplateId || wm.templates?.[0]?.id;
                    setWm((prev) => {
                      const next = {
                        ...prev,
                        rotation: val,
                        templates: (prev.templates || []).map((t) =>
                          t.id === activeId ? { ...t, rotation: val } : t
                        ),
                      };
                      saveEventWatermarkConfig(event.id, event.slug, next);
                      return next;
                    });
                  }}
                  className="w-full accent-brand-500 cursor-pointer h-1.5 bg-line rounded-lg"
                />
              </div>

              {/* Opacity Slider */}
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-semibold uppercase tracking-wider text-muted flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-brand-600" /> Opacity
                  </span>
                  <span className="font-mono font-medium text-ink">
                    {Math.round(safeOpacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  value={safeOpacity}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const activeId = wm.activeTemplateId || wm.templates?.[0]?.id;
                    setWm((prev) => {
                      const next = {
                        ...prev,
                        opacity: val,
                        templates: (prev.templates || []).map((t) =>
                          t.id === activeId ? { ...t, opacity: val } : t
                        ),
                      };
                      saveEventWatermarkConfig(event.id, event.slug, next);
                      return next;
                    });
                  }}
                  className="w-full accent-brand-500 cursor-pointer h-1.5 bg-line rounded-lg"
                />
              </div>
            </div>

            {/* Save Watermark Settings Button */}
            <Button
              type="button"
              className="w-full"
              onClick={saveWatermark}
              icon={<Sparkles className="h-4 w-4" />}
            >
              Save watermark settings
            </Button>
          </div>
        </Card>
      </div>
    </div>

      <ConfirmDialog open={dialog === "purge"} onClose={() => setDialog(null)} onConfirm={purgeFaces} loading={busy} danger
        title="Delete all face data?" confirmLabel="Delete face data"
        description="All biometric face embeddings for this event are permanently deleted. Photos are kept, but guests will no longer find them by selfie. Re-indexing requires re-uploading." />

      <ConfirmDialog open={dialog === "delete"} onClose={() => setDialog(null)} onConfirm={deleteEvent}
        confirmDisabled={confirmName !== event.name} loading={busy} danger title="Delete this event?" confirmLabel="Delete permanently"
        description={<>This permanently deletes <strong className="text-ink">{formatNumber(event.counts.total)} photos</strong>, their previews and all face data.</>}>
        <div className="mt-4">
          <Field label={`Type "${event.name}" to confirm`} htmlFor="confirm-name">
            <Input id="confirm-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
          </Field>
          {confirmName && confirmName !== event.name && <p className="mt-1.5 text-xs text-red-600">The name doesn&apos;t match.</p>}
        </div>
      </ConfirmDialog>

      {/* AI Template Studio Modal */}
      <TemplateDesignerModal
        isOpen={showDesigner}
        onClose={() => setShowDesigner(false)}
        onApplyTemplate={handleApplyAiTemplate}
        defaultEventName={event.name}
        defaultEventDate={event.event_date || ""}
      />
    </div>
  );
}
