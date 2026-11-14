"use client";

import { useRouter } from "next/navigation";
import { ImagePlus, ScanFace, Sliders, Sparkles, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { adminApi, errorMessage } from "@/lib/api";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_MB } from "@/lib/config";
import { formatNumber } from "@/lib/format";
import { fileToDataUrl, getSavedWatermarkConfig, saveEventWatermarkConfig, type WatermarkConfig, type WatermarkTemplateItem } from "@/lib/image";
import type { EventOut } from "@/lib/types";
import { CoverImage } from "./event-card";
import { EventForm } from "./event-form";
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
        const dataUrl = await fileToDataUrl(f);
        newItems.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${f.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`,
          name: f.name,
          sizeBytes: f.size,
          dataUrl,
        });
      } catch {
        toast.error("Could not read template file", f.name);
      }
    }

    if (newItems.length > 0) {
      setWm((prev) => {
        const existing = prev.templates || [];
        const updated = [...existing, ...newItems];
        const active = updated[updated.length - 1]; // select the newest uploaded template
        return {
          ...prev,
          templates: updated,
          activeTemplateId: active.id,
          imageUrl: active.dataUrl,
        };
      });
      toast.success(
        newItems.length > 1 ? `${newItems.length} templates uploaded` : "Template uploaded",
        "Click 'Save watermark settings' to apply."
      );
    }
  }

  function selectTemplate(item: WatermarkTemplateItem) {
    setWm((prev) => ({
      ...prev,
      activeTemplateId: item.id,
      imageUrl: item.dataUrl,
    }));
  }

  function removeTemplateItem(id: string) {
    setWm((prev) => {
      const updated = (prev.templates || []).filter((t) => t.id !== id);
      const nextActive = updated[0];
      return {
        ...prev,
        templates: updated,
        activeTemplateId: nextActive?.id || null,
        imageUrl: nextActive?.dataUrl || null,
      };
    });
  }

  function resetTemplates() {
    setWm((prev) => ({
      ...prev,
      imageUrl: null,
      templates: [],
      activeTemplateId: null,
    }));
    toast.success("Reset to default Zigmaa logo");
  }

  function handlePreviewClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.max(0, Math.min(100, Math.round(((e.clientY - rect.top) / rect.height) * 100)));
    setWm((prev) => ({ ...prev, xPercent: x, yPercent: y }));
  }

  function saveWatermark() {
    saveEventWatermarkConfig(event.id, event.slug, wm);
    toast.success("Watermark template saved", "Applied to all photo downloads for this event.");
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

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Event details" />
        <div className="p-5">
          <EventForm initial={event} withCover={false} submitLabel="Save changes"
            onSubmit={async ({ name, event_date, venue, description }) => {
              onSaved(await adminApi.updateEvent(event.id, { name, event_date, venue, description }));
              toast.success("Changes saved");
            }} />
        </div>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Cover image" />
          <div className="space-y-3 p-5">
            <div className="overflow-hidden rounded-xl border border-line bg-canvas/60 p-2 flex items-center justify-center min-h-[160px] max-h-[300px]">
              <CoverImage src={event.cover_url} name={event.name} className="max-h-[280px] w-auto max-w-full object-contain block mx-auto shadow-sm" />
            </div>
            <input ref={coverRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} className="sr-only" tabIndex={-1}
                   onChange={(e) => { void changeCover(e.target.files?.[0]); e.target.value = ""; }} />
            <Button variant="outline" className="w-full" loading={coverBusy} onClick={() => coverRef.current?.click()}
                    icon={<ImagePlus className="h-4 w-4" />}>{event.cover_url ? "Replace cover" : "Add cover"}</Button>
          </div>
        </Card>

        {/* Watermark Template & Customization Card */}
        <Card>
          <CardHeader
            title="Watermark template"
            description="Custom watermark applied to all photo downloads for this event"
          />
          <div className="space-y-4 p-5">
            {/* Live Watermark Preview on Event Cover */}
            <div
              ref={previewRef}
              onClick={handlePreviewClick}
              className="relative mx-auto max-h-56 w-full overflow-hidden rounded-xl border border-line bg-canvas flex items-center justify-center cursor-crosshair group select-none shadow-sm"
            >
              <img
                src={event.cover_url || "/default-cover.jpg"}
                alt="Cover Preview"
                className="max-h-52 w-auto max-w-full object-contain block mx-auto"
              />
              {/* Watermark Overlay */}
              <div
                style={{
                  position: "absolute",
                  left: `${wm.xPercent}%`,
                  top: `${wm.yPercent}%`,
                  transform: `translate(-${wm.xPercent}%, -${wm.yPercent}%)`,
                  width: `${wm.sizePercent}%`,
                  opacity: wm.opacity,
                  pointerEvents: "none",
                }}
              >
                <img
                  src={wm.imageUrl || "/watermark.png"}
                  alt="Watermark"
                  style={{
                    width: "100%",
                    height: "auto",
                    display: "block",
                  }}
                />
              </div>
            </div>

            {/* Template / Watermark Upload Section */}
            <div className="space-y-3">
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
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold uppercase tracking-wider text-muted">
                      Saved Templates ({wm.templates.length})
                    </span>
                    <span className="text-[11px] text-muted">Click to select active</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[220px] overflow-y-auto p-1">
                    {wm.templates.map((t) => {
                      const isActive = t.id === (wm.activeTemplateId || wm.templates![0]?.id);
                      return (
                        <div
                          key={t.id}
                          onClick={() => selectTemplate(t)}
                          className={`relative flex items-center justify-between gap-2 rounded-xl border p-2 transition-all cursor-pointer select-none ${
                            isActive
                              ? "border-brand-500 bg-brand-50/40 ring-1 ring-brand-500 shadow-xs"
                              : "border-line bg-surface hover:border-brand-300 hover:bg-canvas/50"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="h-9 w-9 shrink-0 rounded-lg border border-line bg-[repeating-conic-gradient(#e8e4dc_0%_25%,#fdfbf7_0%_50%)] bg-[length:8px_8px] p-0.5 flex items-center justify-center overflow-hidden">
                              <img src={t.dataUrl} alt={t.name} className="max-h-full max-w-full object-contain" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1">
                                <p className="truncate text-xs font-semibold text-ink">{t.name}</p>
                                {isActive && (
                                  <span className="shrink-0 rounded-full bg-brand-100 px-1.5 py-0.2 text-[9px] font-semibold text-brand-700">
                                    Active
                                  </span>
                                )}
                              </div>
                              {t.sizeBytes ? (
                                <p className="text-[10px] text-muted">{(t.sizeBytes / 1024).toFixed(1)} KB</p>
                              ) : null}
                            </div>
                          </div>
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
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => templateRef.current?.click()}
                      icon={<Sparkles className="h-3.5 w-3.5 text-brand-600" />}
                    >
                      + Add more templates
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={resetTemplates}
                      title="Reset to default Zigmaa logo"
                    >
                      Reset
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => templateRef.current?.click()}
                    icon={<Sparkles className="h-4 w-4 text-brand-600" />}
                  >
                    {wm.imageUrl ? "Replace watermark template" : "Upload templates (Multiple)"}
                  </Button>
                  {wm.imageUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={resetTemplates}
                      title="Reset to default logo"
                    >
                      Reset
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Size Slider */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-wider text-muted flex items-center gap-1">
                  <Sliders className="h-3 w-3 text-brand-600" /> Size
                </span>
                <span className="font-mono font-medium text-ink">{wm.sizePercent}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={60}
                step={1}
                value={wm.sizePercent ?? 14}
                onChange={(e) => setWm((prev) => ({ ...prev, sizePercent: Number(e.target.value) }))}
                className="w-full accent-brand-500 cursor-pointer h-1.5 bg-line rounded-lg"
              />
            </div>

            {/* Opacity Slider */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-semibold uppercase tracking-wider text-muted flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-brand-600" /> Opacity
                </span>
                <span className="font-mono font-medium text-ink">{Math.round((wm.opacity ?? 0.4) * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={1.0}
                step={0.05}
                value={wm.opacity ?? 0.4}
                onChange={(e) => setWm((prev) => ({ ...prev, opacity: Number(e.target.value) }))}
                className="w-full accent-brand-500 cursor-pointer h-1.5 bg-line rounded-lg"
              />
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

        <Card className="border-red-200">
          <CardHeader title="Privacy & data" description="Irreversible actions" />
          <div className="space-y-3 p-5">
            <Button variant="outline" className="w-full" onClick={() => setDialog("purge")} disabled={event.counts.faces === 0}
                    icon={<ScanFace className="h-4 w-4" />}>Delete face data ({formatNumber(event.counts.faces)})</Button>
            <Button variant="danger" className="w-full" onClick={() => { setConfirmName(""); setDialog("delete"); }}
                    icon={<Trash2 className="h-4 w-4" />}>Delete event</Button>
          </div>
        </Card>
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
    </div>
  );
}
