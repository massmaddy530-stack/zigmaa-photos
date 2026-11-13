"use client";

import { ImagePlus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, errorMessage } from "@/lib/api";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_MB } from "@/lib/config";
import type { EventCreate, EventOut } from "@/lib/types";
import { Button } from "./ui/button";
import { Field, Input, Textarea } from "./ui/primitives";
import { Alert } from "./ui/states";

export interface EventFormValues extends EventCreate {
  cover?: File | null;
  template?: File | null;
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

export function EventForm({ initial, submitLabel, onSubmit, footerExtra, withCover = true, onValuesChange }: {
  initial?: Partial<EventOut>;
  submitLabel: string;
  onSubmit: (values: EventFormValues) => Promise<void>;
  footerExtra?: ReactNode;
  withCover?: boolean;
  onValuesChange?: (values: {
    name: string;
    date: string;
    venue: string;
    description: string;
    cover: File | null;
    preview: string | null;
    template: File | null;
    templatePreview: string | null;
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [date, setDate] = useState(initial?.event_date ?? "");
  const [venue, setVenue] = useState(initial?.venue ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [cover, setCover] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [template, setTemplate] = useState<File | null>(null);
  const [templatePreview, setTemplatePreview] = useState<string | null>(null);
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

  useEffect(() => {
    if (!template) { setTemplatePreview(null); return; }
    const url = URL.createObjectURL(template);
    setTemplatePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [template]);

  useEffect(() => {
    onValuesChange?.({ name, date, venue, description, cover, preview, template, templatePreview });
  }, [name, date, venue, description, cover, preview, template, templatePreview, onValuesChange]);

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

  function pickTemplate(f: File | undefined) {
    if (!f) return;
    const allowed = ["image/png", "image/svg+xml", "image/webp", "image/jpeg"];
    if (!allowed.includes(f.type)) {
      setErrors((e) => ({ ...e, template: "Use a PNG, SVG, WebP or JPEG image." }));
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setErrors((e) => ({ ...e, template: "Template must be under 10 MB." }));
      return;
    }
    setErrors((e) => ({ ...e, template: undefined }));
    setTemplate(f);
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
        template,
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
            label="Template / Watermark overlay"
            htmlFor="ev-template"
            error={errors.template}
            hint="Upload custom watermark logo or frame overlay (PNG with transparency recommended)."
          >
            <input
              ref={templateFileRef}
              id="ev-template"
              type="file"
              accept="image/png,image/svg+xml,image/webp,image/jpeg"
              className="sr-only"
              onChange={(e) => {
                pickTemplate(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {templatePreview ? (
              <div className="relative flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-12 w-12 shrink-0 rounded-lg border border-line bg-[repeating-conic-gradient(#e8e4dc_0%_25%,#fdfbf7_0%_50%)] bg-[length:10px_10px] p-1 flex items-center justify-center overflow-hidden">
                    <img src={templatePreview} alt="Template preview" className="max-h-full max-w-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{template?.name || "Watermark overlay"}</p>
                    <p className="text-xs text-muted">{template ? (template.size / 1024).toFixed(1) + " KB" : "Custom template"}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTemplate(null)}
                  aria-label="Remove template"
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink transition-colors"
                >
                  <X className="h-4 w-4" />
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
                  <span className="font-medium text-brand-700">Upload template / watermark</span> (PNG, SVG)
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
