import type { Metadata } from "next";
import { GuestPortal } from "./guest-portal";

// Event pages are private-by-link: never let search engines index them.
export const metadata: Metadata = {
  title: "Find your photos",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function GuestEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <GuestPortal slug={slug} />;
}
