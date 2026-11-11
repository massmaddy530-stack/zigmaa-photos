"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Camera,
  ChevronLeft,
  MapPin,
  ScanFace,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { EventForm } from "@/components/event-form";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { adminApi, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";

export default function NewEventPage() {
  const router = useRouter();
  const toast = useToast();
  const [live, setLive] = useState({
    name: "",
    date: "",
    venue: "",
    description: "",
    preview: null as string | null,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link
            href="/dashboard/events"
            className="inline-flex items-center gap-1 hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" />
            Events
          </Link>
        }
        title="Create event"
        description="Set up the event, then upload photos and share the guest link."
      />

      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Event Form Details (7 cols) */}
        <div className="lg:col-span-7 xl:col-span-7">
          <Card>
            <CardHeader
              title="Event information"
              description="Basic information, location and cover photo for this event."
            />
            <div className="p-5 sm:p-6">
              <EventForm
                submitLabel="Create event"
                footerExtra={
                  <Link
                    href="/dashboard/events"
                    className="px-3 text-sm font-medium text-muted hover:text-ink"
                  >
                    Cancel
                  </Link>
                }
                onValuesChange={({ name, date, venue, description, preview }) => {
                  setLive({ name, date, venue, description, preview });
                }}
                onSubmit={async ({ cover, ...values }) => {
                  const ev = await adminApi.createEvent(values);
                  if (cover) {
                    try {
                      await adminApi.uploadCover(ev.id, cover, cover.name);
                    } catch (err) {
                      // The event exists; don't block on the optional cover.
                      toast.error(
                        "Event created, but the cover upload failed",
                        errorMessage(err)
                      );
                    }
                  }
                  toast.success("Event created", "Now upload your photos.");
                  router.push(`/dashboard/events/${ev.id}?tab=upload`);
                }}
              />
            </div>
          </Card>
        </div>

        {/* Right Column: Live Guest Preview & Studio Workflow Guide (5 cols) */}
        <div className="space-y-6 lg:col-span-5 xl:col-span-5">
          {/* Card 1: Live Guest View Preview */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Guest portal preview"
              description="Real-time preview of what guests will see"
              action={
                <Badge tone="brand" dot>
                  Live preview
                </Badge>
              }
            />

            {/* Cover Banner Mockup */}
            {live.preview ? (
              <div className="relative aspect-[16/7] w-full overflow-hidden bg-black/5">
                <img
                  src={live.preview}
                  alt="Event Cover"
                  className="h-full w-full object-cover transition-opacity duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/10" />
                <span className="absolute bottom-2.5 left-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-medium tracking-wide text-white backdrop-blur-sm">
                  Cover Photo
                </span>
              </div>
            ) : (
              <div className="relative aspect-[16/7] w-full overflow-hidden bg-gradient-to-br from-[#1f1014] via-[#35161e] to-[#150a0d] flex flex-col items-center justify-center p-5 text-center">
                <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#dfa843_1px,transparent_1px)] [background-size:14px_14px]" />
                <div className="relative flex flex-col items-center">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dfa843]/15 border border-[#dfa843]/30 px-3 py-1 text-xs font-semibold text-[#f3e5ab] backdrop-blur-sm">
                    <Camera className="h-3.5 w-3.5 text-[#dfa843]" /> MADX Live Gallery
                  </span>
                  <p className="mt-2 text-xs text-[#ebd8bf]/80 max-w-[260px]">
                    Choose a cover image on the left to personalize your guest page
                  </p>
                </div>
              </div>
            )}

            {/* Guest Page Content Preview */}
            <div className="p-5 space-y-4">
              <div>
                <h3 className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl">
                  {live.name.trim() || (
                    <span className="text-muted/60 italic font-normal">
                      Aisha &amp; Rohan&apos;s Wedding
                    </span>
                  )}
                </h3>

                <div className="mt-2 flex flex-wrap items-center gap-y-1.5 gap-x-3 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-brand-600" />
                    {live.date ? formatDate(live.date) : "Date to be announced"}
                  </span>
                  <span className="text-line">•</span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-brand-600" />
                    {live.venue.trim() || "The Grand Palace, Jaipur"}
                  </span>
                </div>
              </div>

              {/* Welcome Description */}
              <div className="rounded-xl border border-line/60 bg-canvas/70 p-3 text-xs text-ink/80 leading-relaxed">
                {live.description.trim() || (
                  <span className="text-muted italic">
                    Welcome to our live photo gallery! Take a selfie below to find your pictures instantly with AI facial recognition.
                  </span>
                )}
              </div>

              {/* Live Feature Badges */}
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="green">
                  <ScanFace className="h-3 w-3" /> AI Face Search
                </Badge>
                <Badge tone="blue">
                  <Zap className="h-3 w-3" /> Live Ingestion
                </Badge>
                <Badge tone="neutral">
                  <ShieldCheck className="h-3 w-3" /> Guest Privacy
                </Badge>
              </div>

              {/* Guest Action Mock Button */}
              <div className="pt-1">
                <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#dfa843] via-[#c99525] to-[#996b17] py-2.5 px-4 text-center text-xs font-semibold text-[#1c1305] shadow-sm select-none opacity-95">
                  <ScanFace className="h-3.5 w-3.5" />
                  <span>Take a Selfie to Find My Photos</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Card 2: Studio Workflow Guide */}
          <Card>
            <CardHeader
              title="Studio quick guide"
              description="Next steps after creating this event"
            />
            <div className="space-y-3.5 p-5 text-xs">
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 border border-brand-200 text-brand-700 font-bold text-xs">
                  1
                </div>
                <div>
                  <div className="font-semibold text-ink">Camera Live Tethering</div>
                  <p className="mt-0.5 text-muted leading-relaxed">
                    Double-click <strong className="font-mono text-ink">MADX-Camera-Sync.exe</strong> on the cameraman laptop to stream photos straight from your camera over Wi-Fi.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-xs">
                  2
                </div>
                <div>
                  <div className="font-semibold text-ink">Instant AI Face Indexing</div>
                  <p className="mt-0.5 text-muted leading-relaxed">
                    Every uploaded photo is automatically analyzed for faces with 512-dim embeddings in milliseconds.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-50 border border-sky-200 text-sky-700 font-bold text-xs">
                  3
                </div>
                <div>
                  <div className="font-semibold text-ink">QR Code &amp; Guest Link</div>
                  <p className="mt-0.5 text-muted leading-relaxed">
                    A printable QR code and custom link will be generated immediately for table cards and guest sharing.
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
