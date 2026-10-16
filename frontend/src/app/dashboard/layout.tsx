import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AppShell>{children}</AppShell>
    </ToastProvider>
  );
}
