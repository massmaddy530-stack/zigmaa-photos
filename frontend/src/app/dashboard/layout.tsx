import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/ui/toast";

// `absolute` skips the root template ("… · ZigMaa Photos") so admin pages show the Everframe name.
export const metadata: Metadata = { title: { absolute: "Dashboard · Everframe" }, robots: { index: false } };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AppShell>{children}</AppShell>
    </ToastProvider>
  );
}
