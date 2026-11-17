import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/ui/toast";

// `absolute` skips the root template so admin pages show the Zigmaa Moments brand.
export const metadata: Metadata = { title: { absolute: "Dashboard · Zigmaa Moments" }, robots: { index: false } };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AppShell>{children}</AppShell>
    </ToastProvider>
  );
}
