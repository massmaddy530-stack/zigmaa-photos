"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  HelpCircle,
  LifeBuoy,
  LogOut,
  Mail,
  MessageSquare,
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
          <p className="max-w-[130px] truncate text-xs font-semibold text-[#0f172a] leading-tight">
            {profile.name || "Studio Admin"}
          </p>
          <p className="text-[10px] text-[#64748b] leading-tight">
            {profile.provider === "google" ? "Google Connected" : "Admin"}
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
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-semibold text-[#e50914]">
                  <ShieldCheck className="h-2.5 w-2.5" />
                  {profile.provider === "google" ? "Google Verified" : "Admin Access"}
                </span>
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
          HELP & SUPPORT MODAL (ONLY in center popup)
      ======================================================== */}
      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setHelpOpen(false)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-100 text-[#e50914]">
                  <HelpCircle className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-[#0f172a]">Help & Support</h2>
                  <p className="text-xs text-[#64748b]">Zigmaa Photos Studio Care</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {/* Email Support Card */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e50914]/10 text-[#e50914]">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">Email Tech Support</p>
                    <a
                      href="mailto:massmaddy530@gmail.com"
                      className="text-xs font-medium text-[#e50914] hover:underline"
                    >
                      massmaddy530@gmail.com
                    </a>
                  </div>
                </div>
              </div>

              {/* Quick Guide Card */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">Studio Workflow Tips</p>
                    <p className="text-[11px] text-slate-500">
                      • Upload cover image & custom watermark in Event creation.
                      <br />• AI Face Search automatically matches guest selfies.
                      <br />• Manage all photo settings directly in your dashboard.
                    </p>
                  </div>
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3.5 py-2.5 border border-emerald-100">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-medium text-emerald-800">All Systems Operational</span>
                </div>
                <span className="text-[10px] font-semibold text-emerald-700">v2.4 Active</span>
              </div>
            </div>

            <div className="mt-5 text-right">
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="w-full rounded-xl bg-[#0f172a] py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
              >
                Close Support
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
