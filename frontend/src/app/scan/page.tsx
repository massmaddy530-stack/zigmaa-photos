import type { Metadata } from "next";
import { QrScanner } from "./qr-scanner";

export const metadata: Metadata = {
  title: "Scan event QR code",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ScanPage() {
  return <QrScanner />;
}
