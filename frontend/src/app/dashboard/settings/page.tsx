"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Trash2,
  Upload,
  User,
} from "lucide-react";
import { CSRF_HEADER } from "@/lib/api";

interface UserProfile {
  name: string;
  email: string;
  picture?: string;
  provider: "google" | "password";
}

export default function SettingsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile>({
    name: "Studio Admin",
    email: "massmaddy530@gmail.com",
    picture: "",
    provider: "password",
  });

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  // Status feedback
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProfile() {
      try {
        const res = await fetch("/api/profile", { headers: { Accept: "application/json" } });
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setProfile(data.user);
            setName(data.user.name || "");
            setEmail(data.user.email || "");
            setAvatarPreview(data.user.picture || "");
          }
        }
      } catch (err) {
        console.error("Error loading profile:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, []);

  // Handle local photo upload
  function handlePhotoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file (JPG, PNG, WebP).");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Image size must be less than 5MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setAvatarPreview(dataUrl);
      setError(null);
    };
    reader.readAsDataURL(file);
  }

  function handleRemovePhoto() {
    setAvatarPreview("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword && newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword && newPassword.length < 8) {
      setError("New password must be at least 8 characters long.");
      return;
    }

    setBusy(true);
    try {
      const payload: Record<string, string> = {
        name: name.trim(),
        email: email.trim(),
        picture: avatarPreview,
      };

      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }

      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...CSRF_HEADER,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update profile settings.");
      }

      setProfile(data.user);
      setSuccess("Profile settings saved successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      // Smooth refresh so header avatar updates immediately
      router.refresh();
      setTimeout(() => setSuccess(null), 3500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error saving profile.");
    } finally {
      setBusy(false);
    }
  }

  const initial = name ? name.charAt(0).toUpperCase() : "Z";

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#e50914] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#64748b] hover:text-[#e50914] transition-colors mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Dashboard</span>
          </Link>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#0f172a]">
            Profile & Account Settings
          </h1>
          <p className="text-xs sm:text-sm text-[#64748b]">
            Manage your personal profile photo, display name, email, and security password.
          </p>
        </div>

        {/* Quick Badge */}
        <div className="inline-flex items-center gap-2 self-start rounded-2xl border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold text-slate-700">
            {profile.provider === "google" ? "Google Connected" : "Admin Studio Account"}
          </span>
        </div>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-[#e50914] shadow-sm animate-in fade-in">
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 shadow-sm animate-in fade-in">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <span>{success}</span>
        </div>
      )}

      {/* Main Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ========================================================
            CARD 1: PROFILE PHOTO
        ======================================================== */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
          <h2 className="text-base font-bold text-[#0f172a] mb-1">Profile Photo</h2>
          <p className="text-xs text-[#64748b] mb-6">
            Upload a custom photo for your Zigmaa studio avatar. JPG, PNG or WebP accepted.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-6">
            {/* Avatar Preview */}
            <div className="relative group">
              <div className="relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-tr from-[#e50914] to-[#ff4b4b] text-3xl font-bold text-white shadow-lg ring-4 ring-[#e50914]/20 transition-transform group-hover:scale-105">
                {avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt={name}
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span>{initial}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-[#e50914] text-white shadow-md hover:bg-[#cc0812] transition-colors ring-2 ring-white"
                title="Change Photo"
                aria-label="Upload photo"
              >
                <Camera className="h-4 w-4" />
              </button>
            </div>

            {/* Upload & Remove Controls */}
            <div className="space-y-3 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 transition-colors"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Upload New Photo</span>
                </button>

                {avatarPreview && (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Remove Photo</span>
                  </button>
                )}
              </div>
              <p className="text-[11px] text-[#94a3b8]">
                Recommended: Square image, at least 300x300 pixels, max 5MB.
              </p>
            </div>
          </div>
        </div>

        {/* ========================================================
            CARD 2: PERSONAL DETAILS (NAME & EMAIL)
        ======================================================== */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-[#0f172a]">Personal Information</h2>
          <p className="text-xs text-[#64748b]">Update your studio profile name and notification email.</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2">
            {/* Display Name */}
            <div>
              <label htmlFor="display-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Display Name
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94a3b8]" />
                <input
                  id="display-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 py-2.5 text-sm text-[#0f172a] shadow-sm transition-all focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                />
              </div>
            </div>

            {/* Email Address */}
            <div>
              <label htmlFor="display-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94a3b8]" />
                <input
                  id="display-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 py-2.5 text-sm text-[#0f172a] shadow-sm transition-all focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================
            CARD 3: CHANGE PASSWORD
        ======================================================== */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-100 text-[#e50914]">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0f172a]">Change Password</h2>
              <p className="text-xs text-[#64748b]">Leave blank if you do not wish to change your password.</p>
            </div>
          </div>

          <div className="space-y-4 pt-2 max-w-xl">
            {/* Current Password */}
            <div>
              <label htmlFor="current-pass" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Current Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94a3b8]" />
                <input
                  id="current-pass"
                  type={showCurrentPass ? "text" : "password"}
                  placeholder="Enter current password to verify"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-10 py-2.5 text-sm text-[#0f172a] placeholder:text-[#94a3b8] shadow-sm transition-all focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPass((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-slate-600"
                >
                  {showCurrentPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* New Password & Confirm */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="new-pass" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  New Password
                </label>
                <div className="relative">
                  <input
                    id="new-pass"
                    type={showNewPass ? "text" : "password"}
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 pr-10 py-2.5 text-sm text-[#0f172a] placeholder:text-[#94a3b8] shadow-sm transition-all focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPass((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-slate-600"
                  >
                    {showNewPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="confirm-pass" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    id="confirm-pass"
                    type={showConfirmPass ? "text" : "password"}
                    placeholder="Repeat new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 pr-10 py-2.5 text-sm text-[#0f172a] placeholder:text-[#94a3b8] shadow-sm transition-all focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPass((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-slate-600"
                  >
                    {showConfirmPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================
            SUBMIT / CANCEL BAR
        ======================================================== */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            href="/dashboard"
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-[#64748b] hover:bg-slate-50 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-[#e50914] px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-[#cc0812] active:scale-[0.99] disabled:opacity-50"
          >
            {busy ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Saving...</span>
              </>
            ) : (
              <span>Save Changes</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
