"use client";

import { Eye, EyeOff, ImagePlus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, errorMessage } from "@/lib/api";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_MB } from "@/lib/config";
import type { EventCreate, EventOut } from "@/lib/types";
import { Button } from "./ui/button";
import { Field, Input, Textarea } from "./ui/primitives";
import { Alert } from "./ui/states";

export interface TemplateItem {
  id: string;
  name: string;
  size: number;
  preview: string;
  file: File;
  xPercent?: number;
  yPercent?: number;
  sizePercent?: number;
  opacity?: number;
  enabled?: boolean;
}

export interface EventFormValues extends EventCreate {
  cover?: File | null;
  template?: File | null;
  templates?: File[];
  templateItems?: TemplateItem[];
  activeTemplateId?: string | null;
}

type FieldErrors = Partial<Record<"name" | "event_date" | "venue" | "description" | "cover" | "template", string>>;

/** Maps backend validation errors (422 details with `loc`) onto form fields. */
function fieldErrorsFrom(err: unknown): FieldErrors {
  if (!(err instanceof ApiError) || err.code !== "validation_error" || !Array.isArray(err.details)) return {};
  const out: FieldErrors = {};
  for (const d of err.details as { loc?: (string | number)[]; msg?: string }[]) {
    const f = d.loc?.[d.loc.length - 1];
    if (typeof f === "string" && ["name", "event_date", "venue", "description"].includes(f)) {
      out[f as keyof FieldErrors] = d.msg?.replace(/^Value error, /, "") ?? "Invalid value";
    }
  }
  return out;
}

export function EventForm({
  initial,
  submitLabel,
  onSubmit,
  footerExtra,
  withCover = true,
  templateItems: propTemplates,
  onTemplateItemsChange,
  activeTemplateId: propActiveId,
  onSelectTemplate,
  onValuesChange,
}: {
  initial?: Partial<EventOut>;
  submitLabel: string;
  onSubmit: (values: EventFormValues) => Promise<void>;
  footerExtra?: ReactNode;
  withCover?: boolean;
  templateItems?: TemplateItem[];
  onTemplateItemsChange?: (items: TemplateItem[]) => void;
  activeTemplateId?: string | null;
  onSelectTemplate?: (id: string) => void;
  onValuesChange?: (values: {
    name: string;
    date: string;
    venue: string;
    description: string;
    cover: File | null;
    preview: string | null;
    template?: File | null;
    templatePreview?: string | null;
    templates?: File[];
    templateItems?: TemplateItem[];
    activeTemplateId?: string | null;
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [date, setDate] = useState(initial?.event_date ?? "");
  const [venue, setVenue] = useState(initial?.venue ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [cover, setCover] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [localTemplates, setLocalTemplates] = useState<TemplateItem[]>([]);
  const [localActiveId, setLocalActiveId] = useState<string | null>(null);

  const templates = propTemplates !== undefined ? propTemplates : localTemplates;
  const activeTemplateId = propActiveId !== undefined ? propActiveId : localActiveId;

  function updateTemplates(next: TemplateItem[] | ((prev: TemplateItem[]) => TemplateItem[])) {
    const updated = typeof next === "function" ? next(templates) : next;
    if (onTemplateItemsChange) {
      onTemplateItemsChange(updated);
    } else {
      setLocalTemplates(updated);
    }
    return updated;
  }

  function changeActiveTemplate(id: string | null) {
    if (onSelectTemplate && id) {
      onSelectTemplate(id);
    } else {
      setLocalActiveId(id);
    }
  }

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const templateFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!cover) { setPreview(null); return; }
    const url = URL.createObjectURL(cover);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  const activeTemplate = templates.find((t) => t.id === activeTemplateId) || templates[0] || null;

  useEffect(() => {
    onValuesChange?.({
      name,
      date,
      venue,
      description,
      cover,
      preview,
      template: activeTemplate?.file || null,
      templatePreview: activeTemplate?.preview || null,
      templates: templates.map((t) => t.file),
      templateItems: templates,
      activeTemplateId: activeTemplate?.id || null,
    });
  }, [name, date, venue, description, cover, preview, activeTemplate, templates, onValuesChange]);

  function pickCover(f: File | undefined) {
    if (!f) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(f.type)) {
      setErrors((e) => ({ ...e, cover: "Use a JPEG, PNG or WebP image." }));
      return;
    }
    if (f.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setErrors((e) => ({ ...e, cover: `Image must be under ${MAX_UPLOAD_MB} MB.` }));
      return;
    }
    setErrors((e) => ({ ...e, cover: undefined }));
    setCover(f);
  }

  function pickTemplates(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const allowed = ["image/png", "image/svg+xml", "image/webp", "image/jpeg"];
    const newItems: TemplateItem[] = [];
    let errorMsg: string | undefined;

    const defaultCorners = [
      { x: 88, y: 88 },
      { x: 88, y: 12 },
      { x: 12, y: 12 },
      { x: 12, y: 88 },
      { x: 50, y: 88 },
    ];

    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      if (!allowed.includes(f.type)) {
        errorMsg = "Use PNG, SVG, WebP or JPEG images for templates.";
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        errorMsg = "Each template must be under 10 MB.";
        continue;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${f.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const preview = URL.createObjectURL(f);
      const corner = defaultCorners[(templates.length + newItems.length) % defaultCorners.length];
      newItems.push({
        id,
        name: f.name,
        size: f.size,
        preview,
        file: f,
        xPercent: corner.x,
        yPercent: corner.y,
        sizePercent: 14,
        opacity: 0.40,
        enabled: true,
      });
    }

    if (errorMsg && newItems.length === 0) {
      setErrors((e) => ({ ...e, template: errorMsg }));
      return;
    }
    setErrors((e) => ({ ...e, template: undefined }));

    const updated = [...templates, ...newItems];
    updateTemplates(updated);
    if (!activeTemplateId && updated.length > 0) {
      changeActiveTemplate(updated[0].id);
    }
  }

  function toggleTemplateEnabled(id: string) {
    const updated = templates.map((t) =>
      t.id === id ? { ...t, enabled: t.enabled === false ? true : false } : t
    );
    updateTemplates(updated);
  }

  function removeTemplate(id: string) {
    const target = templates.find((t) => t.id === id);
    if (target?.preview) {
      try { URL.revokeObjectURL(target.preview); } catch {}
    }
    const updated = templates.filter((t) => t.id !== id);
    updateTemplates(updated);
    if (activeTemplateId === id) {
      changeActiveTemplate(updated[0]?.id || null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: FieldErrors = {};
    if (!name.trim()) local.name = "Event name is required.";
    if (name.trim().length > 200) local.name = "Keep the name under 200 characters.";
    if (venue.length > 300) local.venue = "Keep the venue under 300 characters.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setFormError(null);
    try {
      await onSubmit({
        name: name.trim(),
        event_date: date || null,
        venue: venue.trim() || null,
        description: description.trim() || null,
        cover,
        template: activeTemplate?.file || null,
        templates: templates.map((t) => t.file),
        templateItems: templates,
        activeTemplateId: activeTemplate?.id || null,
      });
    } catch (err) {
      const fe = fieldErrorsFrom(err);
      setErrors(fe);
      if (!Object.keys(fe).length) setFormError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {formError ? <Alert tone="error" title="Could not save">{errorMessage(formError)}</Alert> : null}
      <Field label="Event name" htmlFor="ev-name" error={errors.name}>
        <Input id="ev-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required
               placeholder="e.g. Aisha & Rohan's Wedding" aria-invalid={!!errors.name} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Date" htmlFor="ev-date" error={errors.event_date}>
          <Input id="ev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Venue" htmlFor="ev-venue" error={errors.venue}>
          <Input id="ev-venue" value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={300}
                 placeholder="e.g. The Grand Palace, Jaipur" />
        </Field>
      </div>
      <Field label="Description" htmlFor="ev-desc" error={errors.description} hint="Shown to guests on the event page.">
        <Textarea id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000}
                  placeholder="A short welcome message for your guests" />
      </Field>
      {withCover && (
        <>
          <Field label="Cover image" htmlFor="ev-cover" error={errors.cover} hint="Optional. Shown at the top of the guest page.">
            <input ref={fileRef} id="ev-cover" type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} className="sr-only"
                   onChange={(e) => { pickCover(e.target.files?.[0]); e.target.value = ""; }} />
            {preview ? (
              <div className="relative overflow-hidden rounded-xl border border-line bg-canvas/60 p-2 flex items-center justify-center min-h-[160px] max-h-[380px]">
                <img src={preview} alt="Cover preview" className="max-h-[360px] w-auto max-w-full rounded-lg object-contain block mx-auto shadow-sm" />
                <button type="button" onClick={() => setCover(null)} aria-label="Remove cover"
                        className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white hover:bg-black/85 backdrop-blur-sm transition-colors shadow-md">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()}
                      className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-canvas/50 px-4 py-8 text-sm text-muted transition hover:border-brand-300 hover:bg-brand-50/40">
                <ImagePlus className="h-6 w-6 text-brand-500" aria-hidden />
                <span><span className="font-medium text-brand-700">Choose an image</span> (JPEG, PNG or WebP)</span>
              </button>
            )}
          </Field>

          <Field
            label={`Templates / Watermark overlays ${templates.length > 0 ? `(${templates.length})` : ""}`}
            htmlFor="ev-template"
            error={errors.template}
            hint="Upload custom watermark logos or frame overlays. Select multiple files at once (PNG with transparency recommended)."
          >
            <input
              ref={templateFileRef}
              id="ev-template"
              type="file"
              multiple
              accept="image/png,image/svg+xml,image/webp,image/jpeg"
              className="sr-only"
              onChange={(e) => {
                pickTemplates(e.target.files);
                e.target.value = "";
              }}
            />
            {templates.length > 0 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[300px] overflow-y-auto p-1">
                  {templates.map((t) => {
                    const isActive = t.id === (activeTemplateId || templates[0]?.id);
                    return (
                      <div
                        key={t.id}
                        onClick={() => changeActiveTemplate(t.id)}
                        className={`relative flex items-center justify-between gap-2.5 rounded-xl border p-2.5 transition-all cursor-pointer select-none ${
                          isActive
                            ? "border-brand-500 bg-brand-50/40 ring-1 ring-brand-500 shadow-xs"
                            : "border-line bg-surface hover:border-brand-300 hover:bg-canvas/50"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className="h-10 w-10 shrink-0 rounded-lg border border-line bg-[repeating-conic-gradient(#e8e4dc_0%_25%,#fdfbf7_0%_50%)] bg-[length:8px_8px] p-0.5 flex items-center justify-center overflow-hidden">
                            <img src={t.preview} alt={t.name} className="max-h-full max-w-full object-contain" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate text-xs font-semibold text-ink">{t.name}</p>
                              {isActive && (
                                <span className="shrink-0 rounded-full bg-brand-100 px-1.5 py-0.2 text-[10px] font-semibold text-brand-700">
                                  Selected
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted">
                              {(t.size / 1024).toFixed(1)} KB &bull; {t.enabled === false ? "Hidden" : "Visible"}
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
                            aria-label={t.enabled === false ? "Show on photo" : "Hide from photo"}
                            className={`grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors ${
                              t.enabled === false
                                ? "text-muted hover:bg-canvas hover:text-ink"
                                : "text-brand-600 hover:bg-brand-50"
                            }`}
                            title={t.enabled === false ? "Hidden - click to show" : "Visible on photo"}
                          >
                            {t.enabled === false ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeTemplate(t.id);
                            }}
                            aria-label={`Remove ${t.name}`}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                            title="Remove template"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => templateFileRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-canvas/40 px-3 py-2 text-xs text-muted transition hover:border-brand-300 hover:bg-brand-50/30"
                >
                  <Sparkles className="h-3.5 w-3.5 text-brand-500" aria-hidden />
                  <span className="font-medium text-brand-700">+ Upload more templates</span>
                  <span className="text-[11px] text-muted">(Multi-select supported)</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => templateFileRef.current?.click()}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-dashed border-line bg-canvas/40 px-4 py-4 text-sm text-muted transition hover:border-brand-300 hover:bg-brand-50/30"
              >
                <Sparkles className="h-4 w-4 text-brand-500" aria-hidden />
                <span>
                  <span className="font-medium text-brand-700">Upload templates / watermarks</span> (PNG, SVG — multiple files supported)
                </span>
              </button>
            )}
          </Field>
        </>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        {footerExtra}
        <Button type="submit" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
