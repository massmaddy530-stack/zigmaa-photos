"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { CalendarDays, ChevronLeft, LogIn } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { CameraCapture } from "@/components/camera-capture";
import { EventStatusBadge } from "@/components/status-badges";
import { buttonClass } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/primitives";
import { Alert, EmptyState, ErrorState } from "@/components/ui/states";
import { adminApi, ApiError } from "@/lib/api";
import { useQuery } from "@/lib/hooks";

export default function EventCapturePage() {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const event = useQuery(() => adminApi.getEvent(id), [id]);
  const back = (
    <Link href={`/dashboard/events/${id}`} className="inline-flex items-center gap-1 hover:text-ink">
      <ChevronLeft className="h-4 w-4" />Event
    </Link>
  );

  if (event.error && !event.data) {
    const status = event.error instanceof ApiError ? event.error.status : 0;
    if (status === 401) {
      return (
        <Alert tone="error" title="Sign in again" icon={<LogIn className="h-4 w-4" />}>
          <p>Your session expired. Photos already saved on this phone are kept and upload after you sign in.</p>
          <Link href={`/login?next=${encodeURIComponent(pathname)}`} className={buttonClass("outline", "sm", "mt-2")}>Sign in</Link>
        </Alert>
      );
    }
    return (
      <Card>
        {status === 404 ? (
          <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="Event not found" description="It may have been deleted."
            action={<Link className="text-sm font-medium text-brand-700" href="/dashboard/events">Back to events</Link>} />
        ) : <ErrorState error={event.error} onRetry={event.reload} />}
      </Card>
    );
  }

  if (!event.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-36 w-full rounded-2xl" />
      </div>
    );
  }
  const ev = event.data;

  return (
    <>
      <PageHeader
        breadcrumb={back}
        title={<span className="flex flex-wrap items-center gap-3"><span className="min-w-0 break-words">{ev.name}</span><EventStatusBadge status={ev.status} /></span>}
        description="Take photos with this phone's camera. Each photo is saved on the phone first, then uploaded to this event."
      />
      <div className="mx-auto max-w-2xl">
        <CameraCapture eventId={id} disabled={ev.status !== "active"} />
      </div>
    </>
  );
}
