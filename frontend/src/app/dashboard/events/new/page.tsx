"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { EventForm } from "@/components/event-form";
import { Card } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { adminApi, errorMessage } from "@/lib/api";

export default function NewEventPage() {
  const router = useRouter();
  const toast = useToast();

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/dashboard/events" className="inline-flex items-center gap-1 hover:text-ink"><ChevronLeft className="h-4 w-4" />Events</Link>}
        title="Create event"
        description="Set up the event, then upload photos and share the guest link."
      />
      <Card className="max-w-2xl p-5 sm:p-6">
        <EventForm
          submitLabel="Create event"
          footerExtra={<Link href="/dashboard/events" className="px-3 text-sm font-medium text-muted hover:text-ink">Cancel</Link>}
          onSubmit={async ({ cover, ...values }) => {
            const ev = await adminApi.createEvent(values);
            if (cover) {
              try {
                await adminApi.uploadCover(ev.id, cover, cover.name);
              } catch (err) {
                // The event exists; don't block on the optional cover.
                toast.error("Event created, but the cover upload failed", errorMessage(err));
              }
            }
            toast.success("Event created", "Now upload your photos.");
            router.push(`/dashboard/events/${ev.id}?tab=upload`);
          }}
        />
      </Card>
    </>
  );
}
