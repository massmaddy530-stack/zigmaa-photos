import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { Button } from "./button";

export function Pagination({ total, limit, offset, onChange, noun = "items" }: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
  noun?: string;
}) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <nav className="flex items-center justify-between gap-3 pt-2" aria-label="Pagination">
      <p className="text-sm text-muted">
        {formatNumber(offset + 1)}–{formatNumber(Math.min(offset + limit, total))} of {formatNumber(total)} {noun}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}
                icon={<ChevronLeft className="h-4 w-4" />} aria-label="Previous page">
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <span className="text-sm tabular-nums text-muted">{page} / {pages}</span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onChange(offset + limit)}
                aria-label="Next page">
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
