// Mirrors backend/app/schemas.py. Keep in sync when the API changes.

export type EventStatus = "active" | "archived";
export type PhotoStatus = "pending" | "processing" | "indexed" | "failed";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PhotoCounts {
  total: number;
  pending: number;
  processing: number;
  indexed: number;
  failed: number;
  faces: number;
}

export interface EventOut {
  id: string;
  slug: string;
  name: string;
  event_date: string | null;
  venue: string | null;
  description: string | null;
  status: EventStatus;
  cover_url: string | null;
  public_url: string;
  /** When the guest link / QR code stops working; null = never (older servers omit the field). */
  guest_link_expires_at?: string | null;
  created_at: string;
  updated_at: string;
  counts: PhotoCounts;
}

export interface EventCreate {
  name: string;
  event_date?: string | null;
  venue?: string | null;
  description?: string | null;
}

export interface EventUpdate extends Partial<EventCreate> {
  status?: EventStatus;
  guest_link_expires_at?: string | null;
}

export interface PhotoOut {
  id: string;
  event_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  status: PhotoStatus;
  face_count: number;
  attempts: number;
  error_message: string | null;
  source: string;
  created_at: string;
  processed_at: string | null;
  thumbnail_url: string | null;
  preview_url: string | null;
}

export interface FaceOut {
  face_index: number;
  bbox: [number, number, number, number];
  det_score: number;
}

export interface JobOut {
  id: string;
  status: JobStatus;
  attempt: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface PhotoDetailOut extends PhotoOut {
  original_url: string | null;
  faces: FaceOut[];
  jobs: JobOut[];
}

export interface EventStatusOut {
  event_id: string;
  counts: PhotoCounts;
  progress: number;
  is_complete: boolean;
  recent_failures: PhotoOut[];
}

export interface UploadItemResult {
  filename: string;
  status: "created" | "duplicate" | "rejected";
  photo_id: string | null;
  error_code: string | null;
  error: string | null;
  /** A duplicate whose stored file was missing: this upload restored it (older servers omit the field). */
  restored?: boolean;
}

export interface UploadResponse {
  created: number;
  duplicates: number;
  rejected: number;
  items: UploadItemResult[];
}

export interface RetryResponse {
  queued: number;
  photo_ids: string[];
}

export interface OverviewOut {
  events: number;
  active_events: number;
  photos: number;
  indexed_photos: number;
  indexed_faces: number;
  processing: number;
  failures: number;
  recent_events: EventOut[];
}

export interface PublicEventOut {
  slug: string;
  name: string;
  event_date: string | null;
  venue: string | null;
  description: string | null;
  cover_url: string | null;
  photo_count: number;
  matching_available: boolean;
}

export interface MatchItem {
  photo_id: string;
  similarity: number;
  width: number | null;
  height: number | null;
  thumbnail_url: string | null;
  preview_url: string | null;
  /** Short-lived signed link to the original file (full quality). */
  download_url?: string | null;
}

export interface MatchTimings {
  validation_ms: number;
  detection_embedding_ms: number;
  vector_search_ms: number;
  serialization_ms: number;
  total_ms: number;
}

export interface MatchResponse {
  match_token: string | null;
  total: number;
  items: MatchItem[];
  next_cursor: number | null;
  threshold: number;
  timings: MatchTimings | null;
}

export interface MatchPage {
  total: number;
  items: MatchItem[];
  next_cursor: number | null;
}

export interface HealthOut {
  status: "ok" | "degraded";
  version: string;
  checks: Record<string, string>;
}
