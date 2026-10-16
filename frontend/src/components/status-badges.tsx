import { Archive, CheckCircle2, Clock, Loader2, Radio, XCircle } from "lucide-react";
import type { EventStatus, PhotoStatus } from "@/lib/types";
import { Badge, type BadgeTone } from "./ui/primitives";

export const PHOTO_STATUS_META: Record<PhotoStatus, { label: string; tone: BadgeTone; description: string }> = {
  pending: { label: "Queued", tone: "amber", description: "Waiting for a worker" },
  processing: { label: "Processing", tone: "blue", description: "Generating previews and detecting faces" },
  indexed: { label: "Ready", tone: "green", description: "Indexed and searchable" },
  failed: { label: "Failed", tone: "red", description: "Processing failed — can be retried" },
};

export function PhotoStatusBadge({ status, className }: { status: PhotoStatus; className?: string }) {
  const meta = PHOTO_STATUS_META[status];
  const Icon = { pending: Clock, processing: Loader2, indexed: CheckCircle2, failed: XCircle }[status];
  return (
    <Badge tone={meta.tone} className={className}>
      <Icon className={`h-3 w-3 ${status === "processing" ? "animate-spin" : ""}`} aria-hidden />
      {meta.label}
    </Badge>
  );
}

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return status === "active" ? (
    <Badge tone="green"><Radio className="h-3 w-3" aria-hidden />Live</Badge>
  ) : (
    <Badge tone="neutral"><Archive className="h-3 w-3" aria-hidden />Archived</Badge>
  );
}
