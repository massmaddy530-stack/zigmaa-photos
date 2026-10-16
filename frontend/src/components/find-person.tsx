"use client";

import { RotateCcw, ScanSearch, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { adminApi, errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { MatchResponse } from "@/lib/types";
import { MatchResults } from "./match-results";
import { SelfieCapture } from "./selfie-capture";
import { Button } from "./ui/button";
import { Card, CardHeader } from "./ui/primitives";
import { Alert } from "./ui/states";

/** Admin tool: find every photo of one person in this event (e.g. for a VIP or a guest request). */
export function FindPerson({ eventId, indexedCount }: { eventId: string; indexedCount: number }) {
  const [face, setFace] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!face) { setPreview(null); return; }
    const u = URL.createObjectURL(face);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [face]);

  async function search(blob: Blob) {
    setFace(blob);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await adminApi.match(eventId, blob));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFace(null);
    setResult(null);
    setError(null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="h-fit">
        <CardHeader title="Reference face" description="A clear, front-facing photo of one person." />
        <div className="space-y-4 p-5">
          {indexedCount === 0 && <Alert tone="info">No photos have been indexed yet. Upload photos and wait for processing to finish.</Alert>}
          {preview ? (
            <div className="space-y-3">
              <img src={preview} alt="Reference face" className="aspect-square w-full rounded-2xl object-cover" />
              <Button variant="outline" className="w-full" onClick={reset} icon={<RotateCcw className="h-4 w-4" />} disabled={busy}>Use a different photo</Button>
            </div>
          ) : (
            <SelfieCapture onCapture={search} cameraLabel="Use camera" uploadLabel="Choose photo" />
          )}
          <p className="text-xs text-muted">The photo is analysed once and not stored. Results are approximate: always review matches.</p>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader
          title="Matches"
          description={result ? `${formatNumber(result.total)} photo${result.total === 1 ? "" : "s"} at ≥ ${(result.threshold * 100).toFixed(0)}% similarity` : "Results appear here"}
          action={result?.timings ? (
            <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted" title={`detect+embed ${result.timings.detection_embedding_ms.toFixed(0)} ms · search ${result.timings.vector_search_ms.toFixed(0)} ms`}>
              <Timer className="h-3.5 w-3.5" />{result.timings.total_ms.toFixed(0)} ms
            </span>
          ) : undefined}
        />
        <div className="p-5">
          {busy ? (
            <div className="flex flex-col items-center gap-3 py-16 text-sm text-muted">
              <ScanSearch className="h-8 w-8 animate-pulse text-brand-500" aria-hidden />
              Searching faces…
            </div>
          ) : error ? (
            <Alert tone="error" title="Search failed">{errorMessage(error)}</Alert>
          ) : result ? (
            <MatchResults key={result.match_token ?? "none"} initial={result} showSimilarity
              loadPage={(token, cursor) => adminApi.matchPage(eventId, token, cursor)}
              emptyTitle="No matching photos" emptyDescription="Try a clearer, front-facing photo with good lighting."
              onExpired={face ? () => void search(face) : undefined} />
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted">
              <ScanSearch className="h-8 w-8 text-zinc-300" aria-hidden />
              Add a reference photo to search this event.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
