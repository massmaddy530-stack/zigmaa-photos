"use client";

import { Check, Clock, Copy, Download, ExternalLink, Printer, QrCode, RefreshCw } from "lucide-react";
import { useState } from "react";
import { adminApi, errorMessage, publicApi } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { expiryState, fromLocalInput, toLocalInput } from "@/lib/link-expiry";
import type { EventOut } from "@/lib/types";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/modal";
import { Card, CardHeader, Input } from "./ui/primitives";
import { Alert } from "./ui/states";
import { useToast } from "./ui/toast";

export function EventShare({ event, onChanged }: { event: EventOut; onChanged?: (e: EventOut) => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  // The QR SVG is cached for an hour; keying it on the guest link shows a fresh QR whenever the link changes
  // (new LAN address, domain or replaced code). The backend ignores the extra parameter.
  const qrBase = publicApi.qrUrl(event.slug);
  const qr = `${qrBase}${qrBase.includes("?") ? "&" : "?"}u=${encodeURIComponent(event.public_url)}`;
  const expiry = expiryState(event.guest_link_expires_at);
  const [expiryInput, setExpiryInput] = useState(() => toLocalInput(event.guest_link_expires_at));
  const [savingExpiry, setSavingExpiry] = useState(false);

  async function saveExpiry(value: string | null) {
    setSavingExpiry(true);
    try {
      const updated = await adminApi.updateEvent(event.id, { guest_link_expires_at: value });
      onChanged?.(updated);
      setExpiryInput(toLocalInput(updated.guest_link_expires_at));
      toast.success(value ? "Link expiry saved" : "Link expiry removed",
        value ? `The guest link stops working on ${formatDateTime(value)}.` : "The guest link no longer expires.");
    } catch (err) {
      toast.error("Couldn't save the link expiry", errorMessage(err));
    } finally {
      setSavingExpiry(false);
    }
  }

  async function rotate() {
    setRotating(true);
    try {
      const updated = await adminApi.rotateLink(event.id);
      onChanged?.(updated);
      setConfirmRotate(false);
      toast.success("New guest link created", "The old link and QR code no longer work. Print the new QR code.");
    } catch (err) {
      toast.error("Couldn't replace the link", errorMessage(err));
    } finally {
      setRotating(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(event.public_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy", "Select the link and copy it manually.");
    }
  }

  async function downloadQr() {
    try {
      const res = await fetch(qr);
      if (!res.ok) throw new Error();
      const href = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href, download: `${event.name.replace(/[^\w-]+/g, "-")}-qr.svg` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 5000);
    } catch {
      toast.error("Couldn't download the QR code", "Is the API server reachable?");
    }
  }

  function printQr() {
    const w = window.open("", "_blank", "noopener=no,width=600,height=800");
    if (!w) return;
    const doc = w.document;
    doc.title = event.name;
    const style = doc.createElement("style");
    style.textContent = "body{font-family:system-ui,sans-serif;text-align:center;padding:48px}img{width:70%;max-width:420px}h1{margin:0 0 8px}p{color:#555}";
    doc.head.appendChild(style);
    const h1 = doc.createElement("h1"); h1.textContent = event.name;
    const p = doc.createElement("p"); p.textContent = "Scan to find your photos with a selfie";
    const img = doc.createElement("img"); img.src = qr; img.alt = "QR code";
    const url = doc.createElement("p"); url.textContent = event.public_url;
    doc.body.append(h1, p, img, url);
    img.onload = () => w.print();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader title="Guest link" description="Anyone with this link can search the event with their own selfie." />
        <div className="space-y-5 p-5">
          {event.status !== "active" && (
            <Alert tone="warning" title="This event is archived">Guests can&apos;t open the link until you make it live again in Settings.</Alert>
          )}
          {expiry === "expired" && (
            <Alert tone="warning" title="This link has expired">
              Guests see &ldquo;This link has expired&rdquo;. Set a later expiry or remove it below to re-open the link.
            </Alert>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={event.public_url} aria-label="Guest link" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <div className="flex gap-2">
              <Button variant="outline" onClick={copy} icon={copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}>
                {copied ? "Copied" : "Copy"}
              </Button>
              <a href={event.public_url} target="_blank" rel="noopener noreferrer"
                 className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium shadow-sm hover:bg-canvas">
                <ExternalLink className="h-4 w-4" />Open
              </a>
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">Link shared by mistake? Replace it. The current link and printed QR codes stop working.</p>
            <Button variant="outline" size="sm" onClick={() => setConfirmRotate(true)} icon={<RefreshCw className="h-4 w-4" />}>
              Replace link
            </Button>
          </div>
          <div className="space-y-3 rounded-2xl border border-line p-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Clock className="h-4 w-4 text-brand-600" />Link expiry</p>
              <p className="mt-1 text-sm text-muted">
                {expiry === "none" ? "The link works until you replace it or archive the event."
                  : expiry === "active" ? `The link and QR code stop working on ${formatDateTime(event.guest_link_expires_at)}.`
                  : `Expired on ${formatDateTime(event.guest_link_expires_at)}.`}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input type="datetime-local" value={expiryInput} onChange={(e) => setExpiryInput(e.target.value)}
                aria-label="Link expires at" className="sm:max-w-64" />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" loading={savingExpiry} disabled={!fromLocalInput(expiryInput)}
                  onClick={() => void saveExpiry(fromLocalInput(expiryInput))}>
                  Save expiry
                </Button>
                {expiry !== "none" && (
                  <Button variant="ghost" size="sm" disabled={savingExpiry} onClick={() => void saveExpiry(null)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="QR code" description="Print it on table cards, screens or invitations." action={<QrCode className="h-4 w-4 text-muted" />} />
        <div className="flex flex-col items-center gap-4 p-5">
          <div className="rounded-2xl border border-line bg-white p-4">
            <img src={qr} alt={`QR code linking to ${event.public_url}`} className="h-52 w-52" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadQr} icon={<Download className="h-4 w-4" />}>SVG</Button>
            <Button variant="outline" size="sm" onClick={printQr} icon={<Printer className="h-4 w-4" />}>Print</Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog open={confirmRotate} onClose={() => setConfirmRotate(false)} onConfirm={() => void rotate()}
        title="Replace the guest link?" confirmLabel="Replace link" danger loading={rotating}
        description="Guests using the current link or QR code will see “event not available”. Photos are not affected. You'll need to share or print the new QR code." />
    </div>
  );
}
