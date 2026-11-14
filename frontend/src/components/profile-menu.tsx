"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  Headphones,
  LifeBuoy,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { CSRF_HEADER } from "@/lib/api";
import { cn } from "@/lib/format";

interface UserProfile {
  name: string;
  email: string;
  picture?: string;
  provider: "google" | "password";
}

export function ProfileMenu() {
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [profile, setProfile] = useState<UserProfile>({
    name: "Studio Admin",
    email: "massmaddy530@gmail.com",
    picture: "",
    provider: "password",
  });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function handleCopy(text: string, field: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  }

  // Fetch current user profile
  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch("/api/profile", { headers: { Accept: "application/json" } });
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setProfile(data.user);
          }
        }
      } catch {
        // Fallback to cookie if available
        try {
          const match = document.cookie.match(/evp_profile=([^;]+)/);
          if (match) {
            const parsed = JSON.parse(decodeURIComponent(match[1]));
            setProfile(parsed);
          }
        } catch {
          // ignore
        }
      }
    }
    loadProfile();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/session", { method: "DELETE", headers: CSRF_HEADER });
    } catch {
      // ignore
    }
    router.replace("/login");
    router.refresh();
  }

  const initial = profile.name ? profile.name.charAt(0).toUpperCase() : "Z";

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Round Profile Trigger Button */}
      <button
        type="button"
        onClick={() => setDropdownOpen((o) => !o)}
        className="group flex items-center gap-2.5 rounded-full p-1 transition-all hover:bg-slate-100 focus:outline-none"
        aria-label="User Profile and Settings"
      >
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-tr from-[#e50914] to-[#ff4b4b] text-sm font-bold text-white shadow-sm ring-2 ring-white">
          {profile.picture ? (
            <img
              src={profile.picture}
              alt={profile.name}
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span>{initial}</span>
          )}
          {/* Active Online Indicator */}
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
        </div>

        <div className="hidden text-left lg:block">
          <p className="max-w-[140px] truncate text-xs font-semibold text-[#0f172a] leading-tight">
            {profile.name || "Studio Admin"}
          </p>
        </div>

        <ChevronDown
          className={cn(
            "hidden h-3.5 w-3.5 text-[#94a3b8] transition-transform duration-200 lg:block",
            dropdownOpen && "rotate-180 text-[#e50914]"
          )}
        />
      </button>

      {/* Profile Dropdown Menu */}
      {dropdownOpen && (
        <div className="absolute right-0 top-12 z-50 w-72 origin-top-right rounded-2xl border border-slate-200/80 bg-white p-2 shadow-2xl shadow-slate-900/10 backdrop-blur-lg animate-in fade-in zoom-in-95">
          {/* User Card */}
          <div className="rounded-xl bg-slate-50 p-3 mb-1">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-tr from-[#e50914] to-[#ff4b4b] text-base font-bold text-white shadow ring-2 ring-white">
                {profile.picture ? (
                  <img
                    src={profile.picture}
                    alt={profile.name}
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span>{initial}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-[#0f172a]">{profile.name}</p>
                <p className="truncate text-xs text-[#64748b]">{profile.email}</p>
              </div>
            </div>
          </div>

          <div className="h-px bg-slate-100 my-1" />

          {/* Menu Actions */}
          <div className="space-y-0.5">
            {/* Redirect to dedicated Profile Settings Page */}
            <button
              type="button"
              onClick={() => {
                setDropdownOpen(false);
                router.push("/dashboard/settings");
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-[#334155] transition-colors hover:bg-slate-100 hover:text-[#0f172a]"
            >
              <User className="h-4 w-4 text-[#e50914]" />
              <span>Profile Settings</span>
            </button>

            {/* Help & Support stays as a modal in center */}
            <button
              type="button"
              onClick={() => {
                setDropdownOpen(false);
                setHelpOpen(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-[#334155] transition-colors hover:bg-slate-100 hover:text-[#0f172a]"
            >
              <LifeBuoy className="h-4 w-4 text-sky-500" />
              <span>Help & Support</span>
            </button>
          </div>

          <div className="h-px bg-slate-100 my-1" />

          {/* Sign Out Option */}
          <button
            type="button"
            disabled={signingOut}
            onClick={handleSignOut}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            <span>{signingOut ? "Signing out..." : "Sign Out"}</span>
          </button>
        </div>
      )}

      {/* ========================================================
          HELP & SUPPORT MODAL (Rendered via Portal to document.body)
      ======================================================== */}
      {helpOpen && mounted && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="relative w-full max-w-[480px] max-h-[92vh] overflow-y-auto rounded-3xl bg-white shadow-2xl animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Gradient Header matching Zigmaa Photos red theme */}
            <div className="bg-gradient-to-r from-[#e50914] via-[#ee202c] to-[#ff3b4e] p-6 text-white relative">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white shadow-inner backdrop-blur-sm">
                    <Headphones className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-white leading-tight">Help & Support</h2>
                    <p className="text-xs text-white/90 mt-0.5 font-normal">
                      We&apos;re here to assist you with your Zigmaa Photos workspace
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  className="rounded-xl p-1 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-3.5 bg-white">
              <p className="text-[10px] font-bold tracking-wider text-[#94a3b8] uppercase">
                Choose your preferred way to contact us
              </p>

              {/* Call Support Card */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm transition-all hover:border-red-200 hover:shadow-md">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-[#e50914]">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#64748b]">Call Support</p>
                    <a
                      href="tel:+918870235207"
                      className="text-sm font-bold text-[#0f172a] hover:text-[#e50914] transition-colors tracking-wide"
                    >
                      +91 8870235207
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600 border border-emerald-200/80">
                    AVAILABLE
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy("+91 8870235207", "phone")}
                    className="rounded-lg px-2.5 py-1 text-xs font-semibold text-[#64748b] hover:bg-slate-100 hover:text-[#e50914] transition-colors"
                  >
                    {copiedField === "phone" ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <Check className="h-3.5 w-3.5" /> Copied
                      </span>
                    ) : (
                      "Copy"
                    )}
                  </button>
                </div>
              </div>

              {/* Email Support Card */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm transition-all hover:border-red-200 hover:shadow-md">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-[#e50914]">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 truncate">
                    <p className="text-xs font-medium text-[#64748b]">Email Support</p>
                    <a
                      href="mailto:support@zigmaatech.com"
                      className="text-sm font-bold text-[#0f172a] hover:text-[#e50914] transition-colors truncate block"
                    >
                      support@zigmaatech.com
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600 border border-emerald-200/80">
                    AVAILABLE
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy("support@zigmaatech.com", "email")}
                    className="rounded-lg px-2.5 py-1 text-xs font-semibold text-[#64748b] hover:bg-slate-100 hover:text-[#e50914] transition-colors"
                  >
                    {copiedField === "email" ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <Check className="h-3.5 w-3.5" /> Copied
                      </span>
                    ) : (
                      "Copy"
                    )}
                  </button>
                </div>
              </div>

              {/* Official Website Card */}
              <a
                href="https://zigmaatech.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3 text-xs text-[#334155] transition-all hover:bg-slate-100/80 hover:border-slate-300 group"
              >
                <ShieldCheck className="h-4 w-4 text-[#e50914]" />
                <span className="font-normal text-[#64748b]">Official Website:</span>
                <span className="font-bold text-[#0f172a] group-hover:underline">zigmaatech.com</span>
                <ExternalLink className="h-3.5 w-3.5 text-[#94a3b8] ml-auto group-hover:text-[#0f172a] transition-colors" />
              </a>

              {/* Support Operating Hours Card */}
              <div className="flex items-center gap-2.5 rounded-2xl border border-amber-200/80 bg-[#fffbeb] p-3 text-xs text-amber-900">
                <Clock className="h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  <span className="font-semibold">Support operating hours:</span> Mon – Sat, 9:00 AM – 6:00 PM IST
                </span>
              </div>

              {/* Modal Footer */}
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
