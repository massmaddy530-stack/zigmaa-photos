"use client";

import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ImagePlus, ScanFace, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { adminApi, errorMessage } from "@/lib/api";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_MB } from "@/lib/config";
import { formatNumber } from "@/lib/format";
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
  const [coverBusy, setCoverBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [dialog, setDialog] = useState<"purge" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState("");

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

  async function toggleStatus() {
    setStatusBusy(true);
    try {
      const next = event.status === "active" ? "archived" : "active";
      onSaved(await adminApi.updateEvent(event.id, { status: next }));
      toast.success(next === "archived" ? "Event archived" : "Event is live again",
        next === "archived" ? "Guests can no longer open the event link." : "Guests can use the event link again.");
    } catch (err) {
      toast.error("Couldn't change status", errorMessage(err));
    } finally {
      setStatusBusy(false);
    }
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
            <div className="aspect-[16/9] overflow-hidden rounded-xl border border-line">
              <CoverImage src={event.cover_url} name={event.name} />
            </div>
            <input ref={coverRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} className="sr-only" tabIndex={-1}
                   onChange={(e) => { void changeCover(e.target.files?.[0]); e.target.value = ""; }} />
            <Button variant="outline" className="w-full" loading={coverBusy} onClick={() => coverRef.current?.click()}
                    icon={<ImagePlus className="h-4 w-4" />}>{event.cover_url ? "Replace cover" : "Add cover"}</Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Visibility" />
          <div className="space-y-3 p-5 text-sm text-muted">
            <p>{event.status === "active"
              ? "The event is live. Guests with the link can search for their photos."
              : "The event is archived. The guest link is disabled; your photos are kept."}</p>
            <Button variant="outline" className="w-full" loading={statusBusy} onClick={toggleStatus}
                    icon={event.status === "active" ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}>
              {event.status === "active" ? "Archive event" : "Make live again"}
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
