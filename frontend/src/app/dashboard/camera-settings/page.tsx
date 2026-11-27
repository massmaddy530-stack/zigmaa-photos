"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  Check,
  ChevronLeft,
  Cloud,
  Copy,
  Eye,
  EyeOff,
  FolderSync,
  HardDrive,
  Laptop,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Square,
  Wifi,
} from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Field, Input, Select } from "@/components/ui/primitives";
import { Alert } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { adminApi, CSRF_HEADER, errorMessage, uploadPhotos } from "@/lib/api";
import { ACCEPTED_IMAGE_EXTENSIONS, SKIP_UPLOAD_COMPRESSION } from "@/lib/config";
import { optimizePhotoForUpload } from "@/lib/image";
import type { EventOut } from "@/lib/types";

interface CameraSettingsState {
  cloudOnlyMode: boolean;
  ftpEnabled: boolean;
  ftpHost: string;
  ftpPort: number;
  ftpPassiveMode: boolean;
  ftpUsername: string;
  ftpPassword: string;
  targetEventId: string;
  cameraModel: string;
}

const DEFAULT_STATE: CameraSettingsState = {
  cloudOnlyMode: false,
  ftpEnabled: true,
  ftpHost: "ftp.zigmaamoments.com",
  ftpPort: 2121,
  ftpPassiveMode: true,
  ftpUsername: "",
  ftpPassword: "",
  targetEventId: "",
  cameraModel: "Canon EOS R",
};

const STORAGE_KEY = "zigmaa_camera_settings";

function randomPasscode(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  }
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export default function CameraSettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<CameraSettingsState>(DEFAULT_STATE);
  const [events, setEvents] = useState<EventOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Browser Live Folder Auto-Sync state (Chrome/Edge File System Access API)
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncFolderName, setSyncFolderName] = useState<string | null>(null);
  const [syncStats, setSyncStats] = useState({ uploaded: 0, duplicates: 0, deletedLocal: 0, lastFile: "" });
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const seenFilesRef = useRef<Set<string>>(new Set());
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const cached = localStorage.getItem(STORAGE_KEY);
        if (cached && active) {
          setSettings((prev) => ({ ...prev, ...JSON.parse(cached) }));
        }
      } catch {
        /* ignore */
      }

      try {
        const [camRes, evRes] = await Promise.all([
          fetch("/api/camera-settings", { headers: { Accept: "application/json" } }),
          adminApi.listEvents({ limit: 100 }).catch(() => ({ items: [] as EventOut[] })),
        ]);
        if (!active) return;

        const eventItems = evRes.items || [];
        setEvents(eventItems);

        if (camRes.ok) {
          const data = await camRes.json();
          if (data?.settings) {
            setSettings((prev) => {
              const merged = { ...prev, ...data.settings };
              if (!merged.targetEventId && eventItems.length > 0) {
                merged.targetEventId = eventItems[0].id;
              }
              if (!merged.ftpUsername && merged.targetEventId) {
                const ev = eventItems.find((e) => e.id === merged.targetEventId);
                if (ev) merged.ftpUsername = `ev_${ev.slug}`;
              }
              if (!merged.ftpPassword) {
                merged.ftpPassword = randomPasscode(12);
              }
              return merged;
            });
          }
        }
      } catch {
        /* fallback to cached */
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, []);

  function copyValue(val: string, key: string) {
    if (!val || typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  }

  async function saveSettings(nextSettings: CameraSettingsState, showToast = true) {
    setSaving(true);
    try {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
      } catch {
        /* ignore */
      }
      const res = await fetch("/api/camera-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...CSRF_HEADER },
        body: JSON.stringify(nextSettings),
      });
      if (!res.ok) {
        throw new Error("Could not save camera settings");
      }
      if (showToast) {
        toast.success("Camera settings saved", "Your Cloud-Only & FTP preferences are updated.");
      }
    } catch (err) {
      toast.error("Save failed", errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function handleToggleCloudOnly() {
    const updated = { ...settings, cloudOnlyMode: !settings.cloudOnlyMode };
    setSettings(updated);
    void saveSettings(updated, false);
    toast.success(
      updated.cloudOnlyMode ? "Cloud-Only Mode ON" : "Cloud-Only Mode OFF",
      updated.cloudOnlyMode
        ? "Photos go directly to cloud and local copies are auto-removed after upload."
        : "Photos sync to cloud while keeping local copies as backup.",
    );
  }

  function handleEventChange(eventId: string) {
    const ev = events.find((e) => e.id === eventId);
    setSettings((prev) => ({
      ...prev,
      targetEventId: eventId,
      ftpUsername: ev ? `ev_${ev.slug}` : prev.ftpUsername,
    }));
  }

  async function scanAndUploadFolder() {
    const dirHandle = dirHandleRef.current;
    const current = settingsRef.current;
    if (!dirHandle || !current.targetEventId) return;

    try {
      // @ts-expect-error File System Access API entries iterator in Chromium
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind !== "file") continue;
        const lower = name.toLowerCase();
        if (!ACCEPTED_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;

        const file = await handle.getFile();
        if (file.size === 0) continue;
        const fingerprint = `${name}:${file.size}:${file.lastModified}`;
        if (seenFilesRef.current.has(fingerprint)) continue;

        seenFilesRef.current.add(fingerprint);
        const prepared = SKIP_UPLOAD_COMPRESSION ? file : await optimizePhotoForUpload(file);
        try {
          const { body } = await uploadPhotos(current.targetEventId, [prepared], () => {});
          const item = body.items[0];
          const isOk = item && (item.status === "created" || item.status === "duplicate");
          if (isOk) {
            let deletedLocal = 0;
            if (current.cloudOnlyMode) {
              try {
                await dirHandle.removeEntry(name);
                deletedLocal = 1;
              } catch {
                /* ignore if folder is read-only */
              }
            }
            setSyncStats((prev) => ({
              uploaded: prev.uploaded + (item.status === "created" ? 1 : 0),
              duplicates: prev.duplicates + (item.status === "duplicate" ? 1 : 0),
              deletedLocal: prev.deletedLocal + deletedLocal,
              lastFile: name,
            }));
          } else {
            seenFilesRef.current.delete(fingerprint);
          }
        } catch {
          seenFilesRef.current.delete(fingerprint);
        }
      }
    } catch (err) {
      toast.error("Folder sync error", errorMessage(err));
      stopFolderSync();
    }
  }

  async function startFolderSync() {
    if (!settings.targetEventId) {
      toast.error("Select an event", "Choose a Target Event before starting Live Folder Sync.");
      return;
    }
    const picker = (window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;

    if (!picker) {
      toast.error(
        "Browser not supported",
        "Live Folder Sync requires Chrome or Edge on desktop. Use Bulk Upload or Zigmaa-Camera-Sync.exe instead.",
      );
      return;
    }

    try {
      const handle = await picker({ mode: settings.cloudOnlyMode ? "readwrite" : "read" });
      dirHandleRef.current = handle;
      seenFilesRef.current.clear();
      setSyncFolderName(handle.name);
      setSyncStats({ uploaded: 0, duplicates: 0, deletedLocal: 0, lastFile: "" });
      setSyncRunning(true);

      await scanAndUploadFolder();
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      syncTimerRef.current = setInterval(() => {
        void scanAndUploadFolder();
      }, 2500);
      toast.success("Live Folder Sync started", `Watching "${handle.name}" every 2.5 seconds.`);
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        toast.error("Could not open folder", errorMessage(err));
      }
    }
  }

  function stopFolderSync() {
    if (syncTimerRef.current) {
      clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    dirHandleRef.current = null;
    setSyncRunning(false);
  }

  const selectedEvent = events.find((e) => e.id === settings.targetEventId);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link href="/dashboard" className="inline-flex items-center gap-1 hover:text-ink">
            <ChevronLeft className="h-4 w-4" />
            Dashboard
          </Link>
        }
        title="Camera Settings"
        description="Configure Cloud-Only storage, direct Camera FTP connection (Canon EOS R / Sony / Nikon), and live folder auto-sync."
      />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left Column (7 cols): Cloud-Only Toggle + FTP Settings */}
          <div className="space-y-6 lg:col-span-7">
            {/* 1. Cloud-Only Storage Toggle */}
            <Card className="overflow-hidden">
              <CardHeader
                title="Cloud-Only Storage Mode"
                description="Control whether photos save only to Cloud (R2) or keep a local device copy"
              />
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-canvas/50 p-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                        settings.cloudOnlyMode
                          ? "bg-brand-600 text-white"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {settings.cloudOnlyMode ? <Cloud className="h-5 w-5" /> : <HardDrive className="h-5 w-5" />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-ink">
                        Cloud-Only Mode: {settings.cloudOnlyMode ? "ON" : "OFF"}
                      </p>
                      <p className="text-xs text-muted mt-0.5">
                        {settings.cloudOnlyMode
                          ? "Photos upload directly to Cloudflare R2 and local temporary files are automatically removed after confirmation."
                          : "Photos upload to Cloudflare R2 while keeping original copies in your local camera/watch folder as backup."}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.cloudOnlyMode}
                    onClick={handleToggleCloudOnly}
                    className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                      settings.cloudOnlyMode ? "bg-brand-600" : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        settings.cloudOnlyMode ? "translate-x-7" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 text-xs">
                  <div
                    className={`rounded-xl border p-3 ${
                      settings.cloudOnlyMode ? "border-brand-300 bg-brand-50/60" : "border-line bg-surface"
                    }`}
                  >
                    <p className="font-semibold text-ink">When ON (Cloud-Only)</p>
                    <p className="mt-1 text-muted">
                      Saves zero permanent photos on laptop/phone/tab. Best when storage space is limited.
                    </p>
                  </div>
                  <div
                    className={`rounded-xl border p-3 ${
                      !settings.cloudOnlyMode ? "border-brand-300 bg-brand-50/60" : "border-line bg-surface"
                    }`}
                  >
                    <p className="font-semibold text-ink">When OFF (Cloud + Local Backup)</p>
                    <p className="mt-1 text-muted">
                      Keeps local files safe in your folder even if venue Wi-Fi drops temporarily.
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            {/* 2. Direct Camera FTP Connection Settings */}
            <Card className="overflow-hidden">
              <CardHeader
                title="Direct Camera FTP Connection"
                description="Connect Canon EOS R / Sony / Nikon Wi-Fi FTP straight to your Zigmaa Moments cloud"
                action={
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      settings.ftpEnabled
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-600 border border-slate-200"
                    }`}
                  >
                    <Wifi className="h-3 w-3" />
                    {settings.ftpEnabled ? "FTP Enabled" : "FTP Paused"}
                  </span>
                }
              />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveSettings(settings);
                }}
                className="p-5 space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Target Event" htmlFor="cam-event">
                    <Select
                      id="cam-event"
                      value={settings.targetEventId}
                      onChange={(e) => handleEventChange(e.target.value)}
                    >
                      {events.length === 0 && <option value="">No active events</option>}
                      {events.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name} ({ev.slug})
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Camera Model" htmlFor="cam-model">
                    <Select
                      id="cam-model"
                      value={settings.cameraModel}
                      onChange={(e) => setSettings((p) => ({ ...p, cameraModel: e.target.value }))}
                    >
                      <option value="Canon EOS R">Canon EOS R / R5 / R6</option>
                      <option value="Sony Alpha">Sony Alpha (a7 / a6400 / a7IV)</option>
                      <option value="Nikon Z">Nikon Z Series</option>
                      <option value="Other">Other FTP Camera</option>
                    </Select>
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Field label="FTP Server Host (KVM2 / Domain)" htmlFor="cam-host">
                      <div className="flex gap-1.5">
                        <Input
                          id="cam-host"
                          value={settings.ftpHost}
                          onChange={(e) => setSettings((p) => ({ ...p, ftpHost: e.target.value }))}
                          placeholder="ftp.zigmaamoments.com"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => copyValue(settings.ftpHost, "host")}
                          icon={copiedKey === "host" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                        >
                          Copy
                        </Button>
                      </div>
                    </Field>
                  </div>

                  <Field label="FTP Port" htmlFor="cam-port">
                    <div className="flex gap-1.5">
                      <Input
                        id="cam-port"
                        type="number"
                        min={1}
                        max={65535}
                        value={settings.ftpPort}
                        onChange={(e) => setSettings((p) => ({ ...p, ftpPort: Number(e.target.value) || 2121 }))}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => copyValue(String(settings.ftpPort), "port")}
                        icon={copiedKey === "port" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      />
                    </div>
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="FTP Username (Event Route)" htmlFor="cam-user">
                    <div className="flex gap-1.5">
                      <Input
                        id="cam-user"
                        value={settings.ftpUsername}
                        onChange={(e) => setSettings((p) => ({ ...p, ftpUsername: e.target.value }))}
                        placeholder={selectedEvent ? `ev_${selectedEvent.slug}` : "ev_wedding2026"}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => copyValue(settings.ftpUsername, "user")}
                        icon={copiedKey === "user" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      />
                    </div>
                  </Field>

                  <Field label="FTP Password" htmlFor="cam-pass">
                    <div className="flex gap-1.5">
                      <div className="relative flex-1">
                        <Input
                          id="cam-pass"
                          type={showPassword ? "text" : "password"}
                          value={settings.ftpPassword}
                          onChange={(e) => setSettings((p) => ({ ...p, ftpPassword: e.target.value }))}
                          className="pr-9"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink cursor-pointer"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSettings((p) => ({ ...p, ftpPassword: randomPasscode(12) }))}
                        title="Generate new passcode"
                        icon={<RefreshCw className="h-3.5 w-3.5" />}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => copyValue(settings.ftpPassword, "pass")}
                        icon={copiedKey === "pass" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      />
                    </div>
                  </Field>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-line">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.ftpPassiveMode}
                      onChange={(e) => setSettings((p) => ({ ...p, ftpPassiveMode: e.target.checked }))}
                      className="rounded border-line accent-brand-600"
                    />
                    <span>Enable Passive Mode (PASV) — Recommended for Canon EOS R Wi-Fi</span>
                  </label>

                  <Button type="submit" loading={saving} icon={<Save className="h-4 w-4" />}>
                    Save Camera Settings
                  </Button>
                </div>
              </form>
            </Card>
          </div>

          {/* Right Column (5 cols): Browser Live Folder Sync + Canon EOS R Setup + .exe Option */}
          <div className="space-y-6 lg:col-span-5">
            {/* 3. Live Folder Auto-Sync (No .exe needed) */}
            <Card className="overflow-hidden">
              <CardHeader
                title="Live Folder Auto-Sync (No .exe)"
                description="Watch a tether/Canon Utility folder directly from Chrome or Edge"
              />
              <div className="p-5 space-y-4">
                <p className="text-xs text-muted">
                  Works on Phone/Tab/Laptop when photos land in a folder. Honors your{" "}
                  <strong className="text-ink">Cloud-Only ({settings.cloudOnlyMode ? "ON" : "OFF"})</strong> toggle automatically.
                </p>

                {syncRunning ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                        <FolderSync className="h-4 w-4 animate-spin" />
                        Watching: {syncFolderName}
                      </span>
                      <Button size="sm" variant="danger" onClick={stopFolderSync} icon={<Square className="h-3 w-3" />}>
                        Stop Sync
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
                      <div className="rounded-lg bg-white p-2 border border-emerald-100">
                        <p className="font-bold text-ink">{syncStats.uploaded}</p>
                        <p className="text-[11px] text-muted">Uploaded</p>
                      </div>
                      <div className="rounded-lg bg-white p-2 border border-emerald-100">
                        <p className="font-bold text-ink">{syncStats.duplicates}</p>
                        <p className="text-[11px] text-muted">Skipped</p>
                      </div>
                      <div className="rounded-lg bg-white p-2 border border-emerald-100">
                        <p className="font-bold text-ink">{syncStats.deletedLocal}</p>
                        <p className="text-[11px] text-muted">Cleaned</p>
                      </div>
                    </div>
                    {syncStats.lastFile && (
                      <p className="text-[11px] text-emerald-800 truncate">Last synced: {syncStats.lastFile}</p>
                    )}
                  </div>
                ) : (
                  <Button
                    type="button"
                    className="w-full"
                    onClick={startFolderSync}
                    icon={<Play className="h-4 w-4" />}
                  >
                    Select Camera Folder & Start Live Sync
                  </Button>
                )}
              </div>
            </Card>

            {/* 4. Canon EOS R FTP Quick Guide */}
            <Card className="overflow-hidden">
              <CardHeader
                title={`${settings.cameraModel} FTP Setup Guide`}
                description="Enter these settings on your camera for direct wireless transfer"
              />
              <div className="p-5 space-y-3 text-xs text-muted">
                <ol className="list-decimal pl-4 space-y-1.5 text-ink">
                  <li>Connect camera to Venue Wi-Fi or Phone Hotspot.</li>
                  <li>Open <span className="font-semibold">Wi-Fi / Bluetooth connection → Transfer images to FTP server</span>.</li>
                  <li>Set <span className="font-semibold">FTP Mode: FTP</span> (Passive Mode: <span className="font-semibold">{settings.ftpPassiveMode ? "Enable" : "Disable"}</span>).</li>
                  <li>Address: <code className="rounded bg-canvas px-1.5 py-0.5 font-mono">{settings.ftpHost}</code> · Port: <code className="rounded bg-canvas px-1.5 py-0.5 font-mono">{settings.ftpPort}</code>.</li>
                  <li>Login Method: Normal · Enter your FTP Username & Password above.</li>
                  <li>Enable <span className="font-semibold">Automatic Transfer</span> — photos go straight to cloud & AI face indexing!</li>
                </ol>

                <Alert tone="info" title="KVM2 Cloud FTP Note">
                  Direct Camera-to-Cloud FTP (port {settings.ftpPort}) activates once your backend runs on Hostinger KVM2 VPS. Until then, use{" "}
                  <strong>Live Folder Auto-Sync</strong> above or <strong>Zigmaa-Camera-Sync.exe</strong> on Windows.
                </Alert>
              </div>
            </Card>

            {/* 5. Desktop .exe Option (Preserved) */}
            <Card className="overflow-hidden">
              <CardHeader
                title="Windows Desktop Sync (.exe)"
                description="Optional local FTP & USB tether bridge for Windows laptops"
              />
              <div className="p-5 space-y-3 text-xs text-muted">
                <div className="flex items-start gap-3 rounded-xl border border-line bg-canvas/50 p-3">
                  <Laptop className="h-5 w-5 text-brand-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-ink flex items-center gap-1.5">
                      <Camera className="h-3.5 w-3.5 text-brand-600" />
                      Zigmaa-Camera-Sync.exe
                    </p>
                    <p className="mt-1">
                      Keep using <code className="font-mono">Zigmaa-Camera-Sync.exe</code> on your Windows studio laptop for local FTP or USB camera tethering.
                      {selectedEvent ? ` Active target event: ${selectedEvent.name}.` : ""}
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
