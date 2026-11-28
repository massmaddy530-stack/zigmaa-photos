import { Suspense } from "react";
import { ClientSelector } from "./client-selector";

export default async function ClientSelectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { slug } = await params;
  const { t } = await searchParams;
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl p-8 text-center text-sm text-muted">Loading gallery…</div>}>
      <ClientSelector slug={slug} token={t ?? ""} />
    </Suspense>
  );
}
