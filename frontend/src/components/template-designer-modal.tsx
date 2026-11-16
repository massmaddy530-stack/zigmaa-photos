"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Crown,
  Eye,
  Flower2,
  Palette,
  RotateCcw,
  Sliders,
  Sparkles,
  Type,
  X,
  Camera,
} from "lucide-react";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";

export interface GeneratedTemplateResult {
  id: string;
  name: string;
  preview: string;
  dataUrl: string;
  sizeBytes: number;
  file: File;
  xPercent: number;
  yPercent: number;
  sizePercent: number;
  opacity: number;
}

export interface TemplateDesignerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyTemplate: (result: GeneratedTemplateResult) => void;
  defaultEventName?: string;
  defaultEventDate?: string;
}

export type TemplatePreset =
  | "floral-lilies-banner" // Exact user uploaded design!
  | "royal-crest"
  | "botanical-wreath"
  | "studio-badge"
  | "minimalist-frame";

export function TemplateDesignerModal({
  isOpen,
  onClose,
  onApplyTemplate,
  defaultEventName = "",
  defaultEventDate = "",
}: TemplateDesignerModalProps) {
  // Preset selection
  const [preset, setPreset] = useState<TemplatePreset>("floral-lilies-banner");

  // Text content
  const [subtitle, setSubtitle] = useState("THE WEDDING OF");
  const [names, setNames] = useState("Naveen & Meera");
  const [dateText, setDateText] = useState("22 AUGUST 2026");
  const [venueText, setVenueText] = useState("Jaipur, India");

  // Typography options
  const [fontFamily, setFontFamily] = useState<
    "Great Vibes" | "Alex Brush" | "Cinzel" | "Playfair Display" | "Montserrat"
  >("Great Vibes");
  const [namesFontSize, setNamesFontSize] = useState(48); // px
  const [subtitleFontSize, setSubtitleFontSize] = useState(13); // px
  const [letterSpacing, setLetterSpacing] = useState(3); // px

  // Color options
  const [color, setColor] = useState("#c58f87"); // Rose Gold default matching user photo
  const [showArch, setShowArch] = useState(true);
  const [showFloral, setShowFloral] = useState(true);
  const [showEmblem, setShowEmblem] = useState(true);
  const [showDividers, setShowDividers] = useState(true);

  // Preview background: "dark" | "photo" | "light"
  const [previewBg, setPreviewBg] = useState<"dark" | "photo" | "light">("dark");

  // AI Prompt bar
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  // SVG ref for exporting to PNG
  const svgRef = useRef<SVGSVGElement>(null);

  // Initialize from default event name/date if available
  useEffect(() => {
    if (defaultEventName && defaultEventName.trim()) {
      const trimmed = defaultEventName.trim();
      setNames(trimmed);
      setAiPrompt(trimmed);
    }
    if (defaultEventDate) {
      try {
        const d = new Date(defaultEventDate);
        if (!isNaN(d.getTime())) {
          const formatted = d.toLocaleDateString("en-US", {
            day: "numeric",
            month: "long",
            year: "numeric",
          }).toUpperCase();
          setDateText(formatted);
        }
      } catch {}
    }
  }, [defaultEventName, defaultEventDate]);

  // AI Smart Auto-Fill / Prompt handler
  function handleAiGenerate() {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);

    setTimeout(() => {
      const promptLower = aiPrompt.toLowerCase();

      // Detect names: Look for " & ", " and ", or two names
      let detectedNames = names;
      if (aiPrompt.includes("&")) {
        detectedNames = aiPrompt.split(/wedding|reception|engagement/i)[0].trim();
      } else if (aiPrompt.includes(" and ")) {
        detectedNames = aiPrompt.replace(" and ", " & ").split(/wedding|reception|engagement/i)[0].trim();
      } else {
        detectedNames = aiPrompt.replace(/wedding|photoshoot|event|celebration/gi, "").trim();
      }
      if (detectedNames) setNames(detectedNames);

      // Detect Event Type / Subtitle
      if (promptLower.includes("engagement")) {
        setSubtitle("THE ENGAGEMENT OF");
      } else if (promptLower.includes("reception")) {
        setSubtitle("THE RECEPTION OF");
      } else if (promptLower.includes("save the date")) {
        setSubtitle("SAVE THE DATE");
      } else if (promptLower.includes("birthday") || promptLower.includes("celebration")) {
        setSubtitle("CELEBRATING");
      } else {
        setSubtitle("THE WEDDING OF");
      }

      // Detect Color Palette
      if (promptLower.includes("rose gold") || promptLower.includes("pink") || promptLower.includes("blush")) {
        setColor("#c58f87"); // Rose Gold
      } else if (promptLower.includes("gold") || promptLower.includes("royal") || promptLower.includes("yellow")) {
        setColor("#dfb15b"); // Royal Gold
      } else if (promptLower.includes("white") || promptLower.includes("silver")) {
        setColor("#ffffff"); // White
      } else if (promptLower.includes("black") || promptLower.includes("dark")) {
        setColor("#1c1917"); // Dark
      }

      // Detect Style Preset
      if (promptLower.includes("royal") || promptLower.includes("crest") || promptLower.includes("heraldic")) {
        setPreset("royal-crest");
        setFontFamily("Cinzel");
      } else if (promptLower.includes("wreath") || promptLower.includes("botanical") || promptLower.includes("circle")) {
        setPreset("botanical-wreath");
        setFontFamily("Alex Brush");
      } else if (promptLower.includes("minimal") || promptLower.includes("modern") || promptLower.includes("clean")) {
        setPreset("minimalist-frame");
        setFontFamily("Montserrat");
      } else if (promptLower.includes("studio") || promptLower.includes("camera") || promptLower.includes("photo")) {
        setPreset("studio-badge");
        setFontFamily("Montserrat");
      } else {
        setPreset("floral-lilies-banner");
        setFontFamily("Great Vibes");
      }

      setIsGenerating(false);
    }, 300);
  }

  // Preset Colors
  const COLOR_PALETTES = [
    { label: "Rose Gold", value: "#c58f87" },
    { label: "Royal Gold", value: "#dfb15b" },
    { label: "Pure White", value: "#ffffff" },
    { label: "Matte Dark", value: "#1c1917" },
    { label: "Champagne", value: "#e6c99c" },
    { label: "Silver / Chrome", value: "#e2e8f0" },
  ];

  // Export SVG to high-res transparent PNG and apply
  async function handleApply() {
    if (!svgRef.current) return;

    try {
      const svgEl = svgRef.current;
      const width = Number(svgEl.getAttribute("width")) || 1200;
      const height = Number(svgEl.getAttribute("height")) || 280;

      // Clone SVG and serialize
      const svgString = new XMLSerializer().serializeToString(svgEl);
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const URL = window.URL || window.webkitURL || window;
      const blobUrl = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        // High-res canvas 2x scale for ultra crisp watermark
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);

        URL.revokeObjectURL(blobUrl);

        canvas.toBlob((pngBlob) => {
          if (!pngBlob) return;
          const dataUrl = canvas.toDataURL("image/png");
          const safeName = names.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase() || "ai_template";
          const file = new File([pngBlob], `template_${safeName}.png`, { type: "image/png" });
          const id = `tpl_ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

          // Banner templates look best at bottom-center or bottom-right
          const isBanner = preset === "floral-lilies-banner" || preset === "minimalist-frame";
          onApplyTemplate({
            id,
            name: `${names} (${preset === "floral-lilies-banner" ? "Lilies Banner" : preset})`,
            preview: dataUrl,
            dataUrl,
            sizeBytes: pngBlob.size,
            file,
            xPercent: 50, // Center placed
            yPercent: isBanner ? 88 : 85,
            sizePercent: isBanner ? 38 : 22,
            opacity: 0.85,
          });

          onClose();
        }, "image/png");
      };

      img.src = blobUrl;
    } catch (err) {
      console.error("Failed to export template PNG", err);
    }
  }

  if (!isOpen) return null;

  return (
    <Modal open={isOpen} onClose={onClose} size="xl" bare>
      <div className="relative max-w-5xl w-full max-h-[92vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-line">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4 bg-canvas/40 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600 border border-brand-200">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-ink">AI Template & Watermark Studio</h2>
              <p className="text-xs text-muted">
                Create luxury wedding monograms, floral arched banners, and studio templates with instant transparent export.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* AI Magic Prompt Input Bar */}
        <div className="px-6 py-3 border-b border-line bg-gradient-to-r from-brand-50/50 via-canvas to-amber-50/30 flex items-center gap-3 shrink-0">
          <div className="relative flex-1">
            <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-500" />
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAiGenerate()}
              placeholder="e.g. Royal Wedding for Naveen & Meera, Rose Gold with Floral Lilies Arch..."
              className="w-full rounded-xl border border-brand-200 bg-white pl-9 pr-3 py-1.5 text-xs text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 shadow-xs"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleAiGenerate}
            loading={isGenerating}
            className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shrink-0 cursor-pointer shadow-xs"
            icon={<Sparkles className="h-3.5 w-3.5" />}
          >
            AI Magic Auto-Fill
          </Button>
        </div>

        {/* Main Body: 2 Columns (Left: Live Preview Canvas, Right: Full Controls) */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-y-auto divide-y lg:divide-y-0 lg:divide-x divide-line">
          {/* Left Column: Canvas Preview (7 cols) */}
          <div className="lg:col-span-7 p-6 flex flex-col items-center justify-center bg-canvas/30 select-none">
            {/* Background Style Switcher */}
            <div className="w-full mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5 text-brand-600" /> Live Vector Preview
              </span>
              <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewBg("dark")}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    previewBg === "dark" ? "bg-slate-900 text-white shadow-xs" : "text-muted hover:text-ink"
                  }`}
                >
                  Dark Canvas
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewBg("photo")}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    previewBg === "photo" ? "bg-brand-600 text-white shadow-xs" : "text-muted hover:text-ink"
                  }`}
                >
                  On Photo
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewBg("light")}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    previewBg === "light" ? "bg-white text-ink border border-line shadow-xs" : "text-muted hover:text-ink"
                  }`}
                >
                  Transparent Grid
                </button>
              </div>
            </div>

            {/* Live Template Container */}
            <div
              className={`w-full rounded-2xl border border-line p-6 flex items-center justify-center shadow-inner transition-colors min-h-[320px] max-h-[460px] overflow-hidden relative ${
                previewBg === "dark"
                  ? "bg-[#0b0f19]"
                  : previewBg === "photo"
                  ? "bg-cover bg-center"
                  : "bg-[repeating-conic-gradient(#e2e8f0_0%_25%,#ffffff_0%_50%)] bg-[length:16px_16px]"
              }`}
              style={
                previewBg === "photo"
                  ? { backgroundImage: "url('/default-cover.jpg')" }
                  : undefined
              }
            >
              {/* Dimmer overlay for photo preview */}
              {previewBg === "photo" && (
                <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" />
              )}

              {/* RENDERED SVG TEMPLATES */}
              <div className="relative z-10 w-full flex items-center justify-center overflow-x-auto p-2">
                {preset === "floral-lilies-banner" && (
                  <FloralLiliesBannerSVG
                    ref={svgRef}
                    subtitle={subtitle}
                    names={names}
                    dateText={dateText}
                    fontFamily={fontFamily}
                    namesFontSize={namesFontSize}
                    subtitleFontSize={subtitleFontSize}
                    letterSpacing={letterSpacing}
                    color={color}
                    showArch={showArch}
                    showFloral={showFloral}
                    showEmblem={showEmblem}
                    showDividers={showDividers}
                  />
                )}

                {preset === "royal-crest" && (
                  <RoyalCrestSVG
                    ref={svgRef}
                    subtitle={subtitle}
                    names={names}
                    dateText={dateText}
                    fontFamily={fontFamily}
                    namesFontSize={namesFontSize}
                    subtitleFontSize={subtitleFontSize}
                    color={color}
                  />
                )}

                {preset === "botanical-wreath" && (
                  <BotanicalWreathSVG
                    ref={svgRef}
                    subtitle={subtitle}
                    names={names}
                    dateText={dateText}
                    fontFamily={fontFamily}
                    namesFontSize={namesFontSize}
                    subtitleFontSize={subtitleFontSize}
                    color={color}
                  />
                )}

                {preset === "studio-badge" && (
                  <StudioBadgeSVG
                    ref={svgRef}
                    names={names}
                    dateText={dateText}
                    venueText={venueText}
                    color={color}
                  />
                )}

                {preset === "minimalist-frame" && (
                  <MinimalistFrameSVG
                    ref={svgRef}
                    subtitle={subtitle}
                    names={names}
                    dateText={dateText}
                    fontFamily={fontFamily}
                    namesFontSize={namesFontSize}
                    color={color}
                  />
                )}
              </div>
            </div>

            <p className="mt-3 text-[11px] text-muted text-center">
              ✓ 100% transparent vector output. Watermark seamlessly blends onto event photos on download.
            </p>
          </div>

          {/* Right Column: Customization Controls (5 cols) */}
          <div className="lg:col-span-5 p-6 space-y-5 overflow-y-auto max-h-[75vh]">
            {/* 1. Template Presets Tabs */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5 mb-2">
                <Crown className="h-3.5 w-3.5 text-brand-600" />
                <span>Design Preset</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPreset("floral-lilies-banner");
                    setFontFamily("Great Vibes");
                  }}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    preset === "floral-lilies-banner"
                      ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500 font-semibold text-brand-900"
                      : "border-line bg-surface hover:border-brand-300 text-ink"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs">
                    <Flower2 className="h-3.5 w-3.5 text-rose-500" />
                    <span>Floral Lilies Banner</span>
                  </div>
                  <span className="text-[10px] text-muted block mt-0.5">Arched lilies header (Photo match)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPreset("royal-crest");
                    setFontFamily("Cinzel");
                  }}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    preset === "royal-crest"
                      ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500 font-semibold text-brand-900"
                      : "border-line bg-surface hover:border-brand-300 text-ink"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs">
                    <Crown className="h-3.5 w-3.5 text-amber-500" />
                    <span>Royal Heraldic Crest</span>
                  </div>
                  <span className="text-[10px] text-muted block mt-0.5">Luxury monogram emblem</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPreset("botanical-wreath");
                    setFontFamily("Alex Brush");
                  }}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    preset === "botanical-wreath"
                      ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500 font-semibold text-brand-900"
                      : "border-line bg-surface hover:border-brand-300 text-ink"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs">
                    <Flower2 className="h-3.5 w-3.5 text-emerald-500" />
                    <span>Botanical Wreath</span>
                  </div>
                  <span className="text-[10px] text-muted block mt-0.5">Delicate circular floral ring</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPreset("studio-badge");
                    setFontFamily("Montserrat");
                  }}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    preset === "studio-badge"
                      ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500 font-semibold text-brand-900"
                      : "border-line bg-surface hover:border-brand-300 text-ink"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs">
                    <Camera className="h-3.5 w-3.5 text-brand-600" />
                    <span>Studio Signature Badge</span>
                  </div>
                  <span className="text-[10px] text-muted block mt-0.5">Photography branding badge</span>
                </button>
              </div>
            </div>

            {/* 2. Text Content Inputs */}
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                <Type className="h-3.5 w-3.5 text-brand-600" />
                <span>Text Details</span>
              </label>

              <div>
                <span className="text-[11px] font-medium text-muted block mb-1">Top Subtitle</span>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="e.g. THE WEDDING OF"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div>
                <span className="text-[11px] font-medium text-muted block mb-1">Couple / Person Names</span>
                <input
                  type="text"
                  value={names}
                  onChange={(e) => setNames(e.target.value)}
                  placeholder="e.g. Naveen & Meera"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[11px] font-medium text-muted block mb-1">Date</span>
                  <input
                    type="text"
                    value={dateText}
                    onChange={(e) => setDateText(e.target.value)}
                    placeholder="e.g. 22 AUGUST 2026"
                    className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <span className="text-[11px] font-medium text-muted block mb-1">Venue / Tagline</span>
                  <input
                    type="text"
                    value={venueText}
                    onChange={(e) => setVenueText(e.target.value)}
                    placeholder="e.g. Jaipur, India"
                    className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>
            </div>

            {/* 3. Font Family & Sizing */}
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5 text-brand-600" />
                <span>Typography & Font Style</span>
              </label>

              <div>
                <span className="text-[11px] font-medium text-muted block mb-1">Names Font Style</span>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value as typeof fontFamily)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
                >
                  <option value="Great Vibes">Great Vibes (Luxury Wedding Cursive)</option>
                  <option value="Alex Brush">Alex Brush (Delicate Calligraphy)</option>
                  <option value="Cinzel">Cinzel (Royal Roman Serif)</option>
                  <option value="Playfair Display">Playfair Display (Editorial Serif)</option>
                  <option value="Montserrat">Montserrat (Clean Modern Sans)</option>
                </select>
              </div>

              {/* Sliders: Names Size, Subtitle Size & Letter Spacing */}
              <div className="grid grid-cols-3 gap-2.5 pt-1">
                <div>
                  <div className="flex items-center justify-between text-[11px] text-muted mb-1">
                    <span>Names</span>
                    <span className="font-mono text-ink font-semibold">{namesFontSize}px</span>
                  </div>
                  <input
                    type="range"
                    min={28}
                    max={72}
                    value={namesFontSize}
                    onChange={(e) => setNamesFontSize(Number(e.target.value))}
                    className="w-full accent-brand-500 h-1.5 bg-line rounded-lg cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-muted mb-1">
                    <span>Subtitle</span>
                    <span className="font-mono text-ink font-semibold">{subtitleFontSize}px</span>
                  </div>
                  <input
                    type="range"
                    min={9}
                    max={20}
                    value={subtitleFontSize}
                    onChange={(e) => setSubtitleFontSize(Number(e.target.value))}
                    className="w-full accent-brand-500 h-1.5 bg-line rounded-lg cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-muted mb-1">
                    <span>Spacing</span>
                    <span className="font-mono text-ink font-semibold">{letterSpacing}px</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={letterSpacing}
                    onChange={(e) => setLetterSpacing(Number(e.target.value))}
                    className="w-full accent-brand-500 h-1.5 bg-line rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* 4. Color Palette */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5 text-brand-600" /> Color Theme
                </span>
                <span className="font-mono text-[11px] uppercase text-ink font-semibold">{color}</span>
              </label>

              <div className="flex items-center gap-2 flex-wrap">
                {COLOR_PALETTES.map((pal) => (
                  <button
                    key={pal.value}
                    type="button"
                    onClick={() => setColor(pal.value)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all cursor-pointer ${
                      color.toLowerCase() === pal.value.toLowerCase()
                        ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500 font-semibold text-brand-900"
                        : "border-line bg-surface hover:bg-canvas text-ink"
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-black/20 shrink-0"
                      style={{ backgroundColor: pal.value }}
                    />
                    <span>{pal.label}</span>
                  </button>
                ))}

                {/* Custom Color Picker */}
                <label className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs cursor-pointer hover:bg-canvas">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="sr-only"
                  />
                  <span
                    className="h-3 w-3 rounded-full border border-black/20 shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span>Custom Hex</span>
                </label>
              </div>
            </div>

            {/* 5. Toggles for Banner Layout Elements */}
            {preset === "floral-lilies-banner" && (
              <div className="pt-2 border-t border-line">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted block mb-2">
                  Decorative Elements
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showFloral}
                      onChange={(e) => setShowFloral(e.target.checked)}
                      className="rounded accent-brand-500 h-3.5 w-3.5"
                    />
                    <span>Corner Floral Lilies</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showArch}
                      onChange={(e) => setShowArch(e.target.checked)}
                      className="rounded accent-brand-500 h-3.5 w-3.5"
                    />
                    <span>Scalloped Arch Frame</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showEmblem}
                      onChange={(e) => setShowEmblem(e.target.checked)}
                      className="rounded accent-brand-500 h-3.5 w-3.5"
                    />
                    <span>Intertwined Hearts ♡♡</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showDividers}
                      onChange={(e) => setShowDividers(e.target.checked)}
                      className="rounded accent-brand-500 h-3.5 w-3.5"
                    />
                    <span>Divider Lines</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-line px-6 py-3.5 bg-canvas/40 shrink-0">
          <button
            type="button"
            onClick={() => {
              setNames("Naveen & Meera");
              setSubtitle("THE WEDDING OF");
              setDateText("22 AUGUST 2026");
              setColor("#c58f87");
              setFontFamily("Great Vibes");
              setPreset("floral-lilies-banner");
            }}
            className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset to Photo Match</span>
          </button>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleApply}
              className="bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs px-5 shadow-xs cursor-pointer"
              icon={<Check className="h-4 w-4" />}
            >
              Apply to Event Watermarks
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------------
// SVG PRESET 1: Floral Lilies Banner (The exact match for the user's uploaded photo!)
// -------------------------------------------------------------------------------------------------
import { forwardRef } from "react";

interface FloralLiliesBannerProps {
  subtitle: string;
  names: string;
  dateText: string;
  fontFamily: string;
  namesFontSize: number;
  subtitleFontSize: number;
  letterSpacing: number;
  color: string;
  showArch: boolean;
  showFloral: boolean;
  showEmblem: boolean;
  showDividers: boolean;
}

const FloralLiliesBannerSVG = forwardRef<SVGSVGElement, FloralLiliesBannerProps>(
  (
    {
      subtitle,
      names,
      dateText,
      fontFamily,
      namesFontSize,
      subtitleFontSize,
      letterSpacing,
      color,
      showArch,
      showFloral,
      showEmblem,
      showDividers,
    },
    ref
  ) => {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1200 280"
        width="1200"
        height="280"
        className="max-h-[260px] w-auto max-w-full drop-shadow-md"
        style={{ overflow: "visible" }}
      >
        <defs>
          <linearGradient id="goldGlow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="50%" stopColor={color} stopOpacity="0.85" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* 1. SCALLOPED ARCH FRAME */}
        {showArch && (
          <path
            d="M 120,240 C 140,160 170,105 260,85 C 310,75 360,50 440,42 C 520,34 600,28 600,28 C 600,28 680,34 760,42 C 840,50 890,75 940,85 C 1030,105 1060,160 1080,240"
            fill="none"
            stroke={color}
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity="0.85"
          />
        )}

        {/* 2. BOTANICAL LILIES - LEFT CORNER */}
        {showFloral && (
          <g transform="translate(10, 40) scale(0.9)" stroke={color} fill="none" strokeWidth="1.8" opacity="0.9">
            {/* Main Lily Petals */}
            <path d="M 90,160 C 60,130 30,120 10,130 C -5,140 10,170 50,180 Z" />
            <path d="M 90,160 C 80,110 85,70 105,50 C 120,40 130,70 115,130 Z" />
            <path d="M 90,160 C 120,130 160,115 190,125 C 205,135 180,165 130,175 Z" />
            <path d="M 90,160 C 50,180 20,205 15,225 C 10,240 40,240 85,210 Z" />
            <path d="M 90,160 C 110,195 135,230 155,240 C 170,245 180,225 140,195 Z" />

            {/* Lily Stamens & Anthers */}
            <path d="M 90,160 C 85,135 88,115 95,100" strokeWidth="1.2" />
            <circle cx="95" cy="98" r="2.5" fill={color} />
            <path d="M 90,160 C 95,135 105,120 115,105" strokeWidth="1.2" />
            <circle cx="116" cy="103" r="2.5" fill={color} />
            <path d="M 90,160 C 105,145 125,135 140,128" strokeWidth="1.2" />
            <circle cx="142" cy="127" r="2.5" fill={color} />

            {/* Buds & Tendril Leaves */}
            <path d="M 30,80 C 45,60 55,40 50,20 C 40,15 30,35 25,60 Z" />
            <path d="M 50,85 C 65,70 90,55 95,35 C 85,30 70,50 55,75 Z" />
            <path d="M 40,90 C 20,105 10,120 5,140" strokeWidth="1.2" />
            <path d="M 70,120 C 55,90 40,60 20,30" strokeWidth="1.2" />
            <circle cx="18" cy="26" r="3" fill={color} opacity="0.7" />
            <circle cx="48" cy="18" r="3" fill={color} opacity="0.7" />
          </g>
        )}

        {/* 3. BOTANICAL LILIES - RIGHT CORNER (Mirrored) */}
        {showFloral && (
          <g transform="translate(1190, 40) scale(-0.9, 0.9)" stroke={color} fill="none" strokeWidth="1.8" opacity="0.9">
            {/* Main Lily Petals */}
            <path d="M 90,160 C 60,130 30,120 10,130 C -5,140 10,170 50,180 Z" />
            <path d="M 90,160 C 80,110 85,70 105,50 C 120,40 130,70 115,130 Z" />
            <path d="M 90,160 C 120,130 160,115 190,125 C 205,135 180,165 130,175 Z" />
            <path d="M 90,160 C 50,180 20,205 15,225 C 10,240 40,240 85,210 Z" />
            <path d="M 90,160 C 110,195 135,230 155,240 C 170,245 180,225 140,195 Z" />

            {/* Lily Stamens & Anthers */}
            <path d="M 90,160 C 85,135 88,115 95,100" strokeWidth="1.2" />
            <circle cx="95" cy="98" r="2.5" fill={color} />
            <path d="M 90,160 C 95,135 105,120 115,105" strokeWidth="1.2" />
            <circle cx="116" cy="103" r="2.5" fill={color} />
            <path d="M 90,160 C 105,145 125,135 140,128" strokeWidth="1.2" />
            <circle cx="142" cy="127" r="2.5" fill={color} />

            {/* Buds & Tendril Leaves */}
            <path d="M 30,80 C 45,60 55,40 50,20 C 40,15 30,35 25,60 Z" />
            <path d="M 50,85 C 65,70 90,55 95,35 C 85,30 70,50 55,75 Z" />
            <path d="M 40,90 C 20,105 10,120 5,140" strokeWidth="1.2" />
            <path d="M 70,120 C 55,90 40,60 20,30" strokeWidth="1.2" />
            <circle cx="18" cy="26" r="3" fill={color} opacity="0.7" />
            <circle cx="48" cy="18" r="3" fill={color} opacity="0.7" />
          </g>
        )}

        {/* 4. TOP SUBTITLE LINE WITH DIAMOND STARS: ✦ THE WEDDING OF ✦ */}
        <g fill={color} opacity="0.95">
          {/* Left Diamond Star */}
          <path d="M 425,65 Q 430,65 430,60 Q 430,65 435,65 Q 430,65 430,70 Q 430,65 425,65 Z" />
          {/* Subtitle Text */}
          <text
            x="600"
            y="69"
            textAnchor="middle"
            fill={color}
            style={{
              fontFamily: "'Cinzel', 'Playfair Display', Georgia, serif",
              fontSize: `${subtitleFontSize}px`,
              letterSpacing: `${letterSpacing}px`,
              fontWeight: 600,
            }}
          >
            {subtitle.toUpperCase()}
          </text>
          {/* Right Diamond Star */}
          <path d="M 765,65 Q 770,65 770,60 Q 770,65 775,65 Q 770,65 770,70 Q 770,65 765,65 Z" />
        </g>

        {/* 5. MAIN NAMES: Naveen & Meera (Luxury Cursive Script) */}
        <text
          x="600"
          y="155"
          textAnchor="middle"
          fill={color}
          style={{
            fontFamily: `'${fontFamily}', 'Great Vibes', 'Alex Brush', cursive, serif`,
            fontSize: `${namesFontSize}px`,
            fontWeight: 500,
          }}
        >
          {names}
        </text>

        {/* Little decorative star sparkle above the ampersand / center */}
        <path
          d="M 598,102 Q 600,102 600,97 Q 600,102 602,102 Q 600,102 600,107 Q 600,102 598,102 Z"
          fill={color}
          opacity="0.8"
        />

        {/* 6. DATE LINE: 22 AUGUST 2026 */}
        <text
          x="600"
          y="200"
          textAnchor="middle"
          fill={color}
          style={{
            fontFamily: "'Cinzel', 'Playfair Display', Georgia, serif",
            fontSize: "14px",
            letterSpacing: "4px",
            fontWeight: 600,
          }}
        >
          {dateText.toUpperCase()}
        </text>

        {/* 7. BOTTOM EMBLEM: Intertwined Hearts ♡♡ with Tapered Divider Lines */}
        <g stroke={color} fill="none" opacity="0.9">
          {/* Left Tapered Line */}
          {showDividers && (
            <line x1="390" y1="230" x2="570" y2="230" strokeWidth="1.2" strokeLinecap="round" />
          )}

          {/* Intertwined Hearts Emblem */}
          {showEmblem && (
            <g transform="translate(600, 230) scale(0.9)" strokeWidth="1.6">
              {/* Left Heart */}
              <path
                d="M -12,-6 C -18,-14 -28,-4 -20,6 L -10,15 L 0,6 C 8,-4 -2,-14 -8,-6"
                stroke={color}
                fill="none"
              />
              {/* Right Heart */}
              <path
                d="M 8,-6 C 2,-14 -8,-4 0,6 L 10,15 L 20,6 C 28,-4 18,-14 12,-6"
                stroke={color}
                fill="none"
              />
            </g>
          )}

          {/* Right Tapered Line */}
          {showDividers && (
            <line x1="630" y1="230" x2="810" y2="230" strokeWidth="1.2" strokeLinecap="round" />
          )}
        </g>
      </svg>
    );
  }
);
FloralLiliesBannerSVG.displayName = "FloralLiliesBannerSVG";

// -------------------------------------------------------------------------------------------------
// SVG PRESET 2: Royal Heraldic Crest Monogram
// -------------------------------------------------------------------------------------------------
interface RoyalCrestProps {
  subtitle: string;
  names: string;
  dateText: string;
  fontFamily: string;
  namesFontSize: number;
  subtitleFontSize: number;
  color: string;
}

const RoyalCrestSVG = forwardRef<SVGSVGElement, RoyalCrestProps>(
  ({ subtitle, names, dateText, fontFamily, color }, ref) => {
    // Extract initials: "Naveen & Meera" -> "N & M"
    const words = names.replace(/&/g, " ").trim().split(/\s+/).filter(Boolean);
    const initial1 = words[0]?.[0] || "N";
    const initial2 = words[1]?.[0] || words[words.length - 1]?.[0] || "M";
    const initialsStr = `${initial1} & ${initial2}`;

    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 600 600"
        width="600"
        height="600"
        className="max-h-[300px] w-auto max-w-full drop-shadow-md"
      >
        <g stroke={color} fill="none" strokeWidth="2.5" opacity="0.95">
          {/* Royal Crown Top */}
          <path
            d="M 270,120 L 260,80 L 285,95 L 300,70 L 315,95 L 340,80 L 330,120 Z"
            fill={color}
            opacity="0.9"
          />
          <circle cx="260" cy="76" r="3" fill={color} />
          <circle cx="300" cy="65" r="3.5" fill={color} />
          <circle cx="340" cy="76" r="3" fill={color} />

          {/* Ornate Circular Crest Borders */}
          <circle cx="300" cy="270" r="140" strokeWidth="2" strokeDasharray="4 3" />
          <circle cx="300" cy="270" r="130" strokeWidth="2.5" />
          <circle cx="300" cy="270" r="115" strokeWidth="1.2" />

          {/* Botanical leaves around the crest */}
          <path d="M 160,270 C 150,220 170,170 210,140" strokeWidth="2" />
          <path d="M 440,270 C 450,220 430,170 390,140" strokeWidth="2" />
          <path d="M 160,270 C 150,330 180,380 230,410" strokeWidth="2" />
          <path d="M 440,270 C 450,330 420,380 370,410" strokeWidth="2" />
        </g>

        {/* Monogram Initials inside the circle */}
        <text
          x="300"
          y="288"
          textAnchor="middle"
          fill={color}
          style={{
            fontFamily: `'${fontFamily}', 'Cinzel', Georgia, serif`,
            fontSize: "64px",
            fontWeight: 600,
          }}
        >
          {initialsStr}
        </text>

        {/* Subtitle above banner */}
        <text
          x="300"
          y="445"
          textAnchor="middle"
          fill={color}
          style={{
            fontFamily: "'Cinzel', Georgia, serif",
            fontSize: "12px",
            letterSpacing: "3px",
            fontWeight: 600,
          }}
        >
          {subtitle.toUpperCase()}
        </text>

        {/* Full Names below */}
        <text
          x="300"
          y="485"
          textAnchor="middle"
          fill={color}
          style={{
            fontFamily: `'${fontFamily}', 'Great Vibes', cursive, serif`,
            fontSize: "36px",
            fontWeight: 500,
          }}
        >
          {names}
        </text>

        {/* Date Line */}
        <text
          x="300"
          y="525"
          textAnchor="middle"
          fill={color}
          style={{
            fontFamily: "'Cinzel', Georgia, serif",
            fontSize: "13px",
            letterSpacing: "3px",
            fontWeight: 600,
          }}
        >
          {dateText.toUpperCase()}
        </text>
      </svg>
    );
  }
);
RoyalCrestSVG.displayName = "RoyalCrestSVG";

// -------------------------------------------------------------------------------------------------
// SVG PRESET 3: Botanical Ring Wreath
// -------------------------------------------------------------------------------------------------
interface BotanicalWreathProps {
  subtitle: string;
  names: string;
  dateText: string;
  fontFamily: string;
  namesFontSize: number;
  subtitleFontSize: number;
  color: string;
}

const BotanicalWreathSVG = forwardRef<SVGSVGElement, BotanicalWreathProps>(
  ({ subtitle, names, dateText, fontFamily, color }, ref) => {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 600 600"
        width="600"
        height="600"
        className="max-h-[300px] w-auto max-w-full drop-shadow-md"
      >
        {/* Botanical Wreath Ring */}
        <g stroke={color} fill="none" strokeWidth="1.8" opacity="0.9">
          <circle cx="300" cy="300" r="210" strokeDasharray="3 4" strokeWidth="1.2" />
          <circle cx="300" cy="300" r="198" strokeWidth="1.8" />

          {/* Leaves and berries looping around wreath */}
          {Array.from({ length: 16 }).map((_, i) => {
            const angle = (i * 360) / 16;
            return (
              <g key={i} transform={`rotate(${angle} 300 300)`}>
                <path d="M 300,90 C 290,75 285,60 295,48 C 305,60 305,75 300,90 Z" fill={color} opacity="0.6" />
                <path d="M 308,98 C 322,90 335,88 342,98 C 332,104 320,102 308,98 Z" fill={color} opacity="0.6" />
                <circle cx="288" cy="70" r="2.5" fill={color} />
              </g>
            );
          })}
        </g>

        {/* Center Typography */}
        <text
          x="300"
          y="235"
          textAnchor="middle"
          fill={color}
          style={{
            fontFamily: "'Cinzel', Georgia, serif",
            fontSize: "13px",
            letterSpacing: "4px",
            fontWeight: 600,
          }}
        >
          {subtitle.toUpperCase()}
        </text>

        <text
          x="300"
          y="310"
          textAnchor="middle"
          fill={color}
          style={{
            fontFamily: `'${fontFamily}', 'Great Vibes', cursive, serif`,
            fontSize: "44px",
            fontWeight: 500,
          }}
        >
          {names}
        </text>

        <text
          x="300"
          y="370"
          textAnchor="middle"
          fill={color}
          style={{
            fontFamily: "'Cinzel', Georgia, serif",
            fontSize: "14px",
            letterSpacing: "3px",
            fontWeight: 600,
          }}
        >
          {dateText.toUpperCase()}
        </text>

        {/* Center tiny heart flourish */}
        <path
          d="M 296,395 C 292,390 286,395 290,400 L 300,410 L 310,400 C 314,395 308,390 304,395 Z"
          fill={color}
          opacity="0.8"
        />
      </svg>
    );
  }
);
BotanicalWreathSVG.displayName = "BotanicalWreathSVG";

// -------------------------------------------------------------------------------------------------
// SVG PRESET 4: Studio Photography Signature Badge
// -------------------------------------------------------------------------------------------------
interface StudioBadgeProps {
  names: string;
  dateText: string;
  venueText: string;
  color: string;
}

const StudioBadgeSVG = forwardRef<SVGSVGElement, StudioBadgeProps>(
  ({ names, dateText, venueText, color }, ref) => {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 700 240"
        width="700"
        height="240"
        className="max-h-[220px] w-auto max-w-full drop-shadow-md"
      >
        <g stroke={color} fill="none" opacity="0.95">
          {/* Outer Badge Border */}
          <rect x="20" y="20" width="660" height="200" rx="16" strokeWidth="2" />
          <rect x="28" y="28" width="644" height="184" rx="12" strokeWidth="1" strokeDasharray="3 3" />

          {/* Left Camera Icon */}
          <g transform="translate(60, 80) scale(1.4)" strokeWidth="1.8">
            <path d="M 6,10 L 12,4 L 24,4 L 30,10 L 36,10 C 38,10 40,12 40,14 L 40,32 C 40,34 38,36 36,36 L 4,36 C 2,36 0,34 0,32 L 0,14 C 0,12 2,10 4,10 Z" />
            <circle cx="20" cy="22" r="7" />
            <circle cx="32" cy="14" r="1.5" fill={color} />
          </g>

          <line x1="140" y1="50" x2="140" y2="190" strokeWidth="1.5" />
        </g>

        {/* Text Content */}
        <text
          x="165"
          y="75"
          fill={color}
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontSize: "12px",
            letterSpacing: "3px",
            fontWeight: 700,
          }}
        >
          CAPTURED WITH LOVE BY
        </text>

        <text
          x="165"
          y="125"
          fill={color}
          style={{
            fontFamily: "'Great Vibes', cursive, serif",
            fontSize: "44px",
            fontWeight: 500,
          }}
        >
          {names}
        </text>

        <text
          x="165"
          y="170"
          fill={color}
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontSize: "11px",
            letterSpacing: "2px",
            fontWeight: 600,
          }}
        >
          {dateText.toUpperCase()} {venueText ? `• ${venueText.toUpperCase()}` : ""} • OFFICIAL MEMORY
        </text>
      </svg>
    );
  }
);
StudioBadgeSVG.displayName = "StudioBadgeSVG";

// -------------------------------------------------------------------------------------------------
// SVG PRESET 5: Minimalist Modern Frame
// -------------------------------------------------------------------------------------------------
interface MinimalistFrameProps {
  subtitle: string;
  names: string;
  dateText: string;
  fontFamily: string;
  namesFontSize: number;
  color: string;
}

const MinimalistFrameSVG = forwardRef<SVGSVGElement, MinimalistFrameProps>(
  ({ subtitle, names, dateText, fontFamily, color }, ref) => {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1000 240"
        width="1000"
        height="240"
        className="max-h-[220px] w-auto max-w-full drop-shadow-md"
      >
        <g stroke={color} fill="none" opacity="0.9">
          {/* Minimalist modern arch border */}
          <path d="M 40,200 L 40,50 C 40,25 60,20 90,20 L 910,20 C 940,20 960,25 960,50 L 960,200" strokeWidth="1.8" />
          <circle cx="500" cy="20" r="4" fill={color} />
        </g>

        <text
          x="500"
          y="65"
          textAnchor="middle"
          fill={color}
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontSize: "12px",
            letterSpacing: "5px",
            fontWeight: 700,
          }}
        >
          {subtitle.toUpperCase()}
        </text>

        <text
          x="500"
          y="135"
          textAnchor="middle"
          fill={color}
          style={{
            fontFamily: `'${fontFamily}', 'Playfair Display', serif`,
            fontSize: "48px",
            fontWeight: 600,
          }}
        >
          {names}
        </text>

        <text
          x="500"
          y="180"
          textAnchor="middle"
          fill={color}
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontSize: "12px",
            letterSpacing: "4px",
            fontWeight: 500,
          }}
        >
          {dateText.toUpperCase()}
        </text>
      </svg>
    );
  }
);
MinimalistFrameSVG.displayName = "MinimalistFrameSVG";
