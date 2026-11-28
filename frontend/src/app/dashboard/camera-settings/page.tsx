"use client";

import * as React from "react";
import {
  Camera,
  Check,
  Cloud,
  Copy,
  Eye,
  EyeOff,
  FolderSync,
  HardDrive,
  Info,
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
import { ACCEPTED_IMAGE_EXTENSIONS, shouldSkipUploadCompression } from "@/lib/config";
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

interface CameraGuideInfo {
  isFtp: boolean;
  label: string;
  steps: string[];
  note: string;
}

const CAMERA_OPTIONS = [
  { value: "canon_ftp", label: "Canon (EOS R / R5 / R6 / 5D IV / 1DX)" },
  { value: "sony_ftp", label: "Sony Alpha (FX3 / A7 IV / A7S III / A7R V / A9)" },
  { value: "nikon_ftp", label: "Nikon (Z6 III / Z8 / Z9 / D6)" },
  { value: "fujifilm_ftp", label: "Fujifilm (X-H2 / X-H2S / GFX)" },
  { value: "panasonic_ftp", label: "Panasonic Lumix (S5 II / GH6 / S1H)" },
  { value: "other_ftp", label: "Other FTP-Supported Camera" },
  { value: "non_ftp", label: "Non-FTP Cameras (USB / Camera App / SD Card)" },
] as const;

function getCameraGuide(
  model: string,
  host: string,
  port: number,
  username: string,
): CameraGuideInfo {
  switch (model) {
    case "canon_ftp":
      return {
        isFtp: true,
        label: "Canon Wireless FTP Setup",
        steps: [
          "Connect camera to Venue Wi-Fi or Phone Hotspot.",
          "Open Menu → Network / Wi-Fi → Transfer images to FTP server.",
          `Select FTP Mode, set Passive Mode to Enable, and enter Server: ${host} (Port ${port}).`,
          `Choose Login Method: Normal, then enter Username (${username || "from left"}) & Password.`,
          "Enable Automatic Transfer so every shot uploads immediately in full original quality.",
        ],
        note: "Direct FTP works on port 2121 over Wi-Fi or mobile hotspot.",
      };
    case "sony_ftp":
      return {
        isFtp: true,
        label: "Sony Alpha / FX3 FTP Setup",
        steps: [
          "Connect camera to Venue Wi-Fi or Phone Hotspot via Network → Wi-Fi Connect.",
          "Open Network → Transfer/Remote → FTP Transfer Func → FTP Server Settings.",
          `Enter Host Name: ${host}, Port: ${port}, and Passive Mode: On.`,
          `Enter User (${username || "from left"}) & Password under User Info Settings.`,
          "Turn On Auto FTP Transfer — photos upload automatically after each shutter click.",
        ],
        note: "Tip: Set File Format to JPEG (or RAW+JPEG with JPEG transfer) for instant guest matching.",
      };
    case "nikon_ftp":
      return {
        isFtp: true,
        label: "Nikon Wireless FTP Setup",
        steps: [
          "Connect camera to Venue Wi-Fi or Phone Hotspot under Network Menu → Connect to FTP server.",
          `Choose FTP as Server Type and enter Address: ${host}, Port: ${port}.`,
          "Enable Passive (PASV) Mode in TCP/IP / FTP options.",
          `Enter User ID (${username || "from left"}) and Password.`,
          "Turn On Auto Send so new photos sync live to your event.",
        ],
        note: "Works on Nikon Z series with built-in Wi-Fi or WT transmitters.",
      };
    case "fujifilm_ftp":
      return {
        isFtp: true,
        label: "Fujifilm FTP Setup",
        steps: [
          "Connect camera to Venue Wi-Fi or Phone Hotspot in Connection Setting.",
          "Open Network/USB Setting → FTP Transfer Setting.",
          `Set Server Address: ${host}, Port: ${port}, Passive Mode: ON.`,
          `Enter Login ID (${username || "from left"}) and Password.`,
          "Enable Auto Image Transfer to upload shots live.",
        ],
        note: "Supported on X-H2, X-H2S, X-T5 (with FT-XH), and GFX series.",
      };
    case "panasonic_ftp":
      return {
        isFtp: true,
        label: "Panasonic Lumix FTP Setup",
        steps: [
          "Connect camera to Venue Wi-Fi or Phone Hotspot via Setup → Wi-Fi.",
          "Select Image Transfer → FTP Transfer.",
          `Enter Host: ${host}, Port: ${port}, and enable Passive Mode.`,
          `Enter Account (${username || "from left"}) and Password.`,
          "Enable Auto Transfer after shooting.",
        ],
        note: "Available on Lumix S5 II, S5 IIX, GH6, and S1 series.",
      };
    case "other_ftp":
      return {
        isFtp: true,
        label: "Universal Camera FTP Setup",
        steps: [
          "Connect your camera (or Wi-Fi adapter) to Venue Wi-Fi or Phone Hotspot.",
          "Open Camera Network / FTP Transfer settings.",
          `Enter Server Host: ${host}, Port: ${port}, and set Passive Mode (PASV) ON.`,
          `Enter Username (${username || "from left"}) and Password.`,
          "Turn On Auto Transfer — photos go straight to your selected event.",
        ],
        note: "Compatible with any camera supporting standard FTP / PASV.",
      };
    case "non_ftp":
    default:
      return {
        isFtp: false,
        label: "Non-FTP Camera Setup (All Other Cameras)",
        steps: [
          "Connect your camera to your laptop, tablet, or phone using a USB cable, SD card reader, or your camera's Wi-Fi app.",
          "Save incoming photos into any folder on your device (for example, Desktop/EventPhotos or Pictures).",
          "Select your Target Event on the left and click 'Select Camera Folder & Start Live Sync' above.",
          "Pick that same folder once — every new photo landing there uploads automatically in original quality.",
        ],
        note: "Works with any DSLR, mirrorless, or phone camera even without built-in FTP.",
      };
  }
}

function generatePassword(length = 12): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-9 shrink-0 px-2.5 text-xs"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      aria-label={`Copy ${label}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

export default function CameraSettingsPage() {
  const toast = useToast();

  const [events, setEvents] = React.useState<EventOut[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);

  const [settings, setSettings] = React.useState<CameraSettingsState>({
    cloudOnlyMode: false,
    ftpEnabled: true,
    ftpHost: "ftp.zigmaamoments.com",
    ftpPort: 2121,
    ftpPassiveMode: true,
    ftpUsername: "",
    ftpPassword: generatePassword(),
    targetEventId: "",
    cameraModel: "canon_ftp",
  });

  // Live Folder Auto-Sync state
  const [watching, setWatching] = React.useState(false);
  const [watchFolderName, setWatchFolderName] = React.useState<string>("");
  const [watchStats, setWatchStats] = React.useState({ synced: 0, deletedLocal: 0, errors: 0 });
  const [lastSyncedFile, setLastSyncedFile] = React.useState<string>("");
  const watchTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const dirHandleRef = React.useRef<FileSystemDirectoryHandle | null>(null);
  const processedFilesRef = React.useRef<Set<string>>(new Set());
  const isScanningRef = React.useRef(false);

  React.useEffect(() => {
    let active = true;
    async function loadData() {
      try {
        const [evRes, cfgRes] = await Promise.all([
          adminApi.listEvents({ limit: 50 }),
          fetch("/api/camera-settings").then((r) => (r.ok ? r.json() : null)),
        ]);
        if (!active) return;

        setEvents(evRes.items);

        const defaultEvent = evRes.items[0];
        setSettings((prev) => {
          const merged: CameraSettingsState = {
            ...prev,
            ...(cfgRes || {}),
          };
          if (!merged.targetEventId && defaultEvent) {
            merged.targetEventId = defaultEvent.id;
            merged.ftpUsername = `ev_${defaultEvent.slug}`;
          } else if (merged.targetEventId && !merged.ftpUsername) {
            const matched = evRes.items.find((e) => e.id === merged.targetEventId);
            if (matched) merged.ftpUsername = `ev_${matched.slug}`;
          }
          if (!CAMERA_OPTIONS.some((o) => o.value === merged.cameraModel)) {
            merged.cameraModel = "canon_ftp";
          }
          return merged;
        });
      } catch (err) {
        if (active) {
          toast.error("Failed to load camera settings", errorMessage(err));
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    loadData();
    return () => {
      active = false;
      if (watchTimerRef.current) clearInterval(watchTimerRef.current);
    };
  }, [toast]);

  const selectedEvent = React.useMemo(
    () => events.find((e) => e.id === settings.targetEventId) ?? events[0],
    [events, settings.targetEventId],
  );

  const guide = React.useMemo(
    () =>
      getCameraGuide(
        settings.cameraModel,
        settings.ftpHost,
        settings.ftpPort,
        settings.ftpUsername,
      ),
    [settings.cameraModel, settings.ftpHost, settings.ftpPort, settings.ftpUsername],
  );

  const handleEventChange = (eventId: string) => {
    const ev = events.find((e) => e.id === eventId);
    setSettings((prev) => ({
      ...prev,
      targetEventId: eventId,
      ftpUsername: ev ? `ev_${ev.slug}` : prev.ftpUsername,
    }));
  };

  const handleSave = async (nextState?: CameraSettingsState) => {
    const payload = nextState ?? settings;
    setSaving(true);
    try {
      const res = await fetch("/api/camera-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...CSRF_HEADER,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not save camera settings");
      }
      toast.success(
        "Camera settings saved",
        payload.cloudOnlyMode
          ? "Local cleanup after upload is enabled."
          : "Local backup copy will be kept.",
      );
    } catch (err) {
      toast.error("Save failed", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleCloudMode = () => {
    const next = { ...settings, cloudOnlyMode: !settings.cloudOnlyMode };
    setSettings(next);
    void handleSave(next);
  };

  const scanAndUploadFolder = React.useCallback(async () => {
    const dirHandle = dirHandleRef.current;
    if (!dirHandle || !selectedEvent || isScanningRef.current) return;
    isScanningRef.current = true;
    try {
      const pendingFiles: { file: File; name: string }[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const entry of (dirHandle as any).values()) {
        if (entry.kind !== "file") continue;
        const lower = entry.name.toLowerCase();
        const isImg = ACCEPTED_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
        if (!isImg) continue;

        const file: File = await entry.getFile();
        if (file.size < 10_000) continue; // skip half-written files
        const sig = `${entry.name}:${file.size}:${file.lastModified}`;
        if (processedFilesRef.current.has(sig)) continue;

        pendingFiles.push({ file, name: entry.name });
        processedFilesRef.current.add(sig);
      }

      if (pendingFiles.length === 0) return;

      const skipOpt = shouldSkipUploadCompression();
      for (const item of pendingFiles) {
        try {
          const readyFile = skipOpt
            ? item.file
            : await optimizePhotoForUpload(item.file);
          await uploadPhotos(selectedEvent.id, [readyFile], () => {});
          setLastSyncedFile(item.name);

          let deleted = false;
          if (settings.cloudOnlyMode) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (dirHandle as any).removeEntry(item.name);
              deleted = true;
            } catch {
              // User did not grant readwrite or OS locked the file
            }
          }
          setWatchStats((s) => ({
            ...s,
            synced: s.synced + 1,
            deletedLocal: s.deletedLocal + (deleted ? 1 : 0),
          }));
        } catch {
          setWatchStats((s) => ({ ...s, errors: s.errors + 1 }));
        }
      }
    } finally {
      isScanningRef.current = false;
    }
  }, [selectedEvent, settings.cloudOnlyMode]);

  const startFolderWatch = async () => {
    if (!selectedEvent) {
      toast.error("Select a target event first");
      return;
    }
    if (typeof window === "undefined" || !("showDirectoryPicker" in window)) {
      toast.error(
        "Folder sync not supported here",
        "Please open this page in Chrome or Edge on desktop/Android to pick a camera folder.",
      );
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
        mode: settings.cloudOnlyMode ? "readwrite" : "read",
      });
      dirHandleRef.current = handle;
      processedFilesRef.current.clear();
      setWatchFolderName(handle.name);
      setWatchStats({ synced: 0, deletedLocal: 0, errors: 0 });
      setWatching(true);

      await scanAndUploadFolder();
      watchTimerRef.current = setInterval(() => {
        void scanAndUploadFolder();
      }, 3000);

      toast.success(
        `Watching folder "${handle.name}"`,
        `Auto-uploading new photos to ${selectedEvent.name}`,
      );
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      toast.error("Could not open folder", errorMessage(err));
    }
  };

  const stopFolderWatch = () => {
    if (watchTimerRef.current) {
      clearInterval(watchTimerRef.current);
      watchTimerRef.current = null;
    }
    dirHandleRef.current = null;
    setWatching(false);
    toast.info("Folder sync stopped");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb="Dashboard / Camera Settings"
        title="Camera & Live Sync"
        description="Connect your camera via Wi-Fi FTP or watch a local folder for automatic original-quality uploads."
      />

      {loading ? (
        <Card className="p-8 text-center text-sm text-[var(--muted-foreground)]">
          Loading camera configuration...
        </Card>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-12">
          {/* Left Column */}
          <div className="min-w-0 space-y-5 lg:col-span-7">
            {/* Storage Behavior Card */}
            <Card>
              <CardHeader
                title="Local Storage Mode"
                description="Choose whether photos stay on your device after uploading."
              />
              <div className="p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-line bg-canvas/60 p-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                      settings.cloudOnlyMode
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-[var(--border)] bg-white text-[var(--muted-foreground)]"
                    }`}
                  >
                    {settings.cloudOnlyMode ? (
                      <Cloud className="h-5 w-5" />
                    ) : (
                      <HardDrive className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">
                      {settings.cloudOnlyMode
                        ? "Delete Local Copy After Upload"
                        : "Keep Local Backup Copy"}
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      {settings.cloudOnlyMode
                        ? "Frees space on your laptop or phone once each photo is safely uploaded."
                        : "Uploads full-resolution photos and keeps your original folder files untouched."}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.cloudOnlyMode}
                  onClick={toggleCloudMode}
                  disabled={saving}
                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center self-end sm:self-center rounded-full transition-colors ${
                    settings.cloudOnlyMode ? "bg-emerald-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      settings.cloudOnlyMode ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
              </div>
            </Card>

            {/* Camera Connection & FTP Settings */}
            <Card>
              <CardHeader
                title="Camera Connection"
                description="Pick your target event and camera model to configure live transfer."
                action={
                  guide.isFtp ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                      <Wifi className="h-3.5 w-3.5" />
                      FTP Ready
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                      <Camera className="h-3.5 w-3.5" />
                      Folder Sync
                    </span>
                  )
                }
              />

              <div className="p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Target Event" htmlFor="target-event">
                  <Select
                    id="target-event"
                    value={settings.targetEventId}
                    onChange={(e) => handleEventChange(e.target.value)}
                  >
                    {events.length === 0 ? (
                      <option value="">No events found — create one first</option>
                    ) : (
                      events.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name} ({ev.slug})
                        </option>
                      ))
                    )}
                  </Select>
                </Field>

                <Field label="Camera Model" htmlFor="camera-model">
                  <Select
                    id="camera-model"
                    value={settings.cameraModel}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, cameraModel: e.target.value }))
                    }
                  >
                    {CAMERA_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {guide.isFtp ? (
                <>
                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <Field label="FTP Server Host" htmlFor="ftp-host">
                        <div className="flex items-center gap-2">
                          <Input
                            id="ftp-host"
                            value={settings.ftpHost}
                            onChange={(e) =>
                              setSettings((s) => ({ ...s, ftpHost: e.target.value }))
                            }
                            placeholder="ftp.zigmaamoments.com"
                          />
                          <CopyButton value={settings.ftpHost} label="FTP Host" />
                        </div>
                      </Field>
                    </div>

                    <Field label="FTP Port" htmlFor="ftp-port">
                      <div className="flex items-center gap-2">
                        <Input
                          id="ftp-port"
                          type="number"
                          value={settings.ftpPort}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              ftpPort: Number(e.target.value) || 2121,
                            }))
                          }
                        />
                        <CopyButton value={String(settings.ftpPort)} label="FTP Port" />
                      </div>
                    </Field>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="FTP Username (Event Route)" htmlFor="ftp-user">
                      <div className="flex items-center gap-2">
                        <Input
                          id="ftp-user"
                          value={settings.ftpUsername}
                          onChange={(e) =>
                            setSettings((s) => ({ ...s, ftpUsername: e.target.value }))
                          }
                          placeholder="ev_event_slug"
                        />
                        <CopyButton value={settings.ftpUsername} label="FTP Username" />
                      </div>
                    </Field>

                    <Field label="FTP Password" htmlFor="ftp-pass">
                      <div className="flex items-center gap-1.5">
                        <div className="relative flex-1">
                          <Input
                            id="ftp-pass"
                            type={showPassword ? "text" : "password"}
                            value={settings.ftpPassword}
                            onChange={(e) =>
                              setSettings((s) => ({ ...s, ftpPassword: e.target.value }))
                            }
                            className="pr-9"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 shrink-0 px-2.5"
                          onClick={() =>
                            setSettings((s) => ({
                              ...s,
                              ftpPassword: generatePassword(),
                            }))
                          }
                          title="Generate new password"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <CopyButton value={settings.ftpPassword} label="FTP Password" />
                      </div>
                    </Field>
                  </div>

                  <div className="mt-5 flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--foreground)]">
                      <input
                        type="checkbox"
                        checked={settings.ftpPassiveMode}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, ftpPassiveMode: e.target.checked }))
                        }
                        className="h-4 w-4 rounded accent-[var(--brand)]"
                      />
                      Enable Passive Mode (PASV) — recommended for camera Wi-Fi
                    </label>

                    <Button
                      type="button"
                      onClick={() => handleSave()}
                      disabled={saving}
                      className="w-full sm:w-auto"
                    >
                      <Save className="h-4 w-4" />
                      {saving ? "Saving..." : "Save Settings"}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="mt-5 flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-[var(--muted-foreground)]">
                    No FTP server credentials needed — use Live Folder Auto-Sync on the right.
                  </p>
                  <Button
                    type="button"
                    onClick={() => handleSave()}
                    disabled={saving}
                    className="w-full sm:w-auto"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? "Saving..." : "Save Event Selection"}
                  </Button>
                </div>
              )}
              </div>
            </Card>
          </div>

          {/* Right Column */}
          <div className="min-w-0 space-y-5 lg:col-span-5">
            {/* Live Folder Auto-Sync */}
            <Card>
              <CardHeader
                title="Live Folder Auto-Sync"
                description="Pick any camera or tether folder — new photos upload automatically in full quality."
                action={
                  watching ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-600" />
                      Watching
                    </span>
                  ) : null
                }
              />

              <div className="space-y-3 p-5">
                {!watching ? (
                  <Button
                    type="button"
                    onClick={startFolderWatch}
                    className="w-full"
                    disabled={!selectedEvent}
                  >
                    <Play className="h-4 w-4" />
                    Select Camera Folder & Start Live Sync
                  </Button>
                ) : (
                  <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-emerald-900">
                        <FolderSync className="h-4 w-4 shrink-0 text-emerald-700" />
                        <span className="truncate">
                          Folder: <strong>{watchFolderName}</strong>
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={stopFolderWatch}
                        className="h-8 shrink-0 text-xs"
                      >
                        <Square className="h-3 w-3 fill-current" />
                        Stop
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-lg bg-white p-2">
                        <div className="text-base font-semibold text-emerald-700">
                          {watchStats.synced}
                        </div>
                        <div className="text-[11px] text-[var(--muted-foreground)]">Uploaded</div>
                      </div>
                      <div className="rounded-lg bg-white p-2">
                        <div className="text-base font-semibold text-[var(--foreground)]">
                          {watchStats.deletedLocal}
                        </div>
                        <div className="text-[11px] text-[var(--muted-foreground)]">Cleaned</div>
                      </div>
                      <div className="rounded-lg bg-white p-2">
                        <div className="text-base font-semibold text-rose-600">
                          {watchStats.errors}
                        </div>
                        <div className="text-[11px] text-[var(--muted-foreground)]">Errors</div>
                      </div>
                    </div>
                    {lastSyncedFile && (
                      <div className="truncate text-[11px] text-emerald-800">
                        Last synced: {lastSyncedFile}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>

            {/* Camera Setup Guide */}
            <Card>
              <CardHeader
                title={guide.label}
                description={
                  guide.isFtp
                    ? "Enter these settings in your camera menu for direct wireless transfer."
                    : "Follow these steps to sync photos from any camera without FTP."
                }
              />
              <div className="space-y-4 p-5">
              <ol className="space-y-2.5 text-xs text-[var(--foreground)]">
                {guide.steps.map((step, index) => (
                  <li key={index} className="flex gap-2.5 leading-relaxed">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[11px] font-semibold text-[var(--brand)]">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>

              <Alert tone="info" icon={<Info className="h-4 w-4" />}>
                <span className="text-xs leading-relaxed">{guide.note}</span>
              </Alert>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
