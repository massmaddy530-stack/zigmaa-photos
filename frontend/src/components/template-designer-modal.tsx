"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Eye,
  Palette,
  RotateCcw,
  Sliders,
  Type,
  X,
  Layers,
  Minus,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { useToast } from "./ui/toast";

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
  | "classic-arched-banner" // Flat background with curved top arch & classic typography (Exact Image 2 match!)
  | "minimalist-straight-banner" // Clean flat horizontal bar with gold accent line
  | "royal-crest" // Luxury heraldic monogram crest
  | "botanical-wreath" // Refined symmetrical laurel wreath
  | "transparent-signature"; // Transparent luxury script watermark

const GOOGLE_FONTS_DEF = `
@import url('https://fonts.googleapis.com/css2?family=Alex+Brush&family=Cinzel:wght@400;600;700&family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,400;1,600;1,700&family=Great+Vibes&family=Montserrat:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&display=swap');
`;

export function TemplateDesignerModal({
  isOpen,
  onClose,
  onApplyTemplate,
  defaultEventName = "",
  defaultEventDate = "",
}: TemplateDesignerModalProps) {
  // Preset selection
  const [preset, setPreset] = useState<TemplatePreset>("classic-arched-banner");

  // Text content
  const [subtitle, setSubtitle] = useState("THE WEDDING OF");
  const [names, setNames] = useState("Arun & Keerthana");
  const [dateText, setDateText] = useState("14 FEBRUARY 2026");
  const [venueText, setVenueText] = useState("The Grand Palace, Chennai");

  // Typography options
  const [fontFamily, setFontFamily] = useState<
    "Playfair Display" | "Cormorant Garamond" | "Cinzel" | "Great Vibes" | "Alex Brush" | "Montserrat"
  >("Playfair Display");
  const [isItalic, setIsItalic] = useState(true);

  // Font size sliders with high, realistic pixel ranges for 1200px vector canvas
  const [namesFontSize, setNamesFontSize] = useState(82); // px (45 - 130)
  const [subtitleFontSize, setSubtitleFontSize] = useState(20); // px (12 - 36)
  const [dateFontSize, setDateFontSize] = useState(18); // px (12 - 32)
  const [letterSpacing, setLetterSpacing] = useState(5); // px (0 - 14)
  const [arcHeight, setArcHeight] = useState(45); // px (0 flat - 65 deep curve)

  // Colors
  const [bgColor, setBgColor] = useState("#faf6ee"); // Flat Warm Ivory Cream (Exact Image 2 match)
  const [textColor, setTextColor] = useState("#581c25"); // Deep Burgundy / Wine (Exact Image 2 match)
  const [borderColor] = useState("#c49b66"); // Subtle Luxury Gold Border

  // Toggles
  const [showBorder, setShowBorder] = useState(true);
  const [showCalendarIcon, setShowCalendarIcon] = useState(true);
  const [showDividers, setShowDividers] = useState(true);
  const [showVenue, setShowVenue] = useState(false);

  // Gemini AI Prompt Bar state
  const toast = useToast();
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  // Preview background: "photo" | "dark" | "grid"
  const [previewBg, setPreviewBg] = useState<"photo" | "dark" | "grid">("photo");

  // SVG ref for exporting to PNG
  const svgRef = useRef<SVGSVGElement>(null);

  // Handle AI Template Generation with Gemini
  async function handleAiGenerate(promptToUse?: string) {
    const text = (promptToUse ?? aiPrompt).trim();
    if (!text) {
      toast.error("Please enter a prompt for the template.");
      return;
    }
    setIsGenerating(true);
    try {
      const res = await fetch("/api/template/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json();
      if (data.ok && data.template) {
        const t = data.template;
        if (t.preset) setPreset(t.preset);
        if (t.subtitle) setSubtitle(t.subtitle);
        if (t.names) setNames(t.names);
        if (t.dateText) setDateText(t.dateText);
        if (t.venueText) setVenueText(t.venueText);
        if (t.fontFamily) setFontFamily(t.fontFamily);
        if (typeof t.isItalic === "boolean") setIsItalic(t.isItalic);
        if (typeof t.namesFontSize === "number") setNamesFontSize(t.namesFontSize);
        if (typeof t.subtitleFontSize === "number") setSubtitleFontSize(t.subtitleFontSize);
        if (typeof t.dateFontSize === "number") setDateFontSize(t.dateFontSize);
        if (typeof t.letterSpacing === "number") setLetterSpacing(t.letterSpacing);
        if (typeof t.arcHeight === "number") setArcHeight(t.arcHeight);
        if (t.bgColor) setBgColor(t.bgColor);
        if (t.textColor) setTextColor(t.textColor);
        if (typeof t.showBorder === "boolean") setShowBorder(t.showBorder);
        if (typeof t.showCalendarIcon === "boolean") setShowCalendarIcon(t.showCalendarIcon);
        if (typeof t.showDividers === "boolean") setShowDividers(t.showDividers);
        if (typeof t.showVenue === "boolean") setShowVenue(t.showVenue);

        toast.success("AI Template Generated!", `Design updated for "${t.names}"`);
      } else {
        toast.error("Generation failed", data.error || "Please try again.");
      }
    } catch {
      toast.error("Network error", "Could not reach AI generation service.");
    } finally {
      setIsGenerating(false);
    }
  }

  // Initialize from default event name/date if available
  useEffect(() => {
    if (defaultEventName && defaultEventName.trim()) {
      const trimmed = defaultEventName.trim();
      setNames(trimmed);
    }
    if (defaultEventDate) {
      try {
        const d = new Date(defaultEventDate);
        if (!isNaN(d.getTime())) {
          const formatted = d.toLocaleDateString("en-US", {
            day: "numeric",
            month: "long",
            year: "numeric",
          });
          setDateText(formatted.toUpperCase());
        }
      } catch {
        // keep fallback
      }
    }
  }, [defaultEventName, defaultEventDate]);

  // Export SVG to high-res PNG and apply as watermark
  async function handleApply() {
    if (!svgRef.current) return;

    try {
      const svgElement = svgRef.current;
      const width = parseInt(svgElement.getAttribute("width") || "1200", 10);
      const height = parseInt(svgElement.getAttribute("height") || "280", 10);

      const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
      svgClone.setAttribute("width", String(width));
      svgClone.setAttribute("height", String(height));

      const svgString = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
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
          const safeName = names.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase() || "template";
          const file = new File([pngBlob], `template_${safeName}.png`, { type: "image/png" });
          const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

          const isBanner = preset === "classic-arched-banner" || preset === "minimalist-straight-banner";
          onApplyTemplate({
            id,
            name: `${names} (${preset === "classic-arched-banner" ? "Arched Banner" : preset})`,
            preview: dataUrl,
            dataUrl,
            sizeBytes: pngBlob.size,
            file,
            xPercent: 50, // Center aligned
            yPercent: isBanner ? 90 : 85, // Placed on bottom of photo
            sizePercent: isBanner ? 88 : 28, // Wide banner across bottom of image
            opacity: 1.0, // Solid crisp banner
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
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-ink">Customize Template</h2>
              <p className="text-xs text-muted">
                Design classic flat banners or watermark templates with custom fonts, colors, and layout.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Gemini AI Prompt Bar */}
        <div className="px-6 py-2.5 border-b border-line bg-gradient-to-r from-amber-50/60 via-brand-50/40 to-surface shrink-0 space-y-2">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-brand-600">
                <Sparkles className="h-4 w-4" />
              </div>
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAiGenerate()}
                placeholder="Describe your template: e.g. Royal maroon & gold wedding banner for Arun & Keerthana 14 Feb 2026 Chennai..."
                className="w-full rounded-xl border border-brand-200 bg-white pl-9 pr-3 py-1.5 text-xs text-ink placeholder:text-muted/65 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 shadow-2xs"
              />
            </div>

            <button
              type="button"
              disabled={isGenerating}
              onClick={() => handleAiGenerate()}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-600 to-rose-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:from-brand-700 hover:to-rose-700 transition-all disabled:opacity-50 cursor-pointer shrink-0"
            >
              {isGenerating ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span>Generating with AI...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>AI Generate Template</span>
                </>
              )}
            </button>
          </div>

          {/* Quick Prompt Ideas */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-[10px] text-muted pb-0.5 scrollbar-none">
            <span className="shrink-0 font-semibold text-brand-800">Quick ideas:</span>
            {[
              "Royal maroon and gold wedding banner for Arun & Keerthana 14 Feb 2026",
              "Classic ivory arched banner for Naveen & Meera 22 August 2026 Jaipur",
              "Minimalist white modern reception banner with gold line",
              "Royal monogram crest for A & K with Cinzel font",
              "Transparent gold calligraphy signature watermark",
            ].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setAiPrompt(p);
                  handleAiGenerate(p);
                }}
                className="shrink-0 rounded-full border border-line bg-surface/90 px-2.5 py-0.5 hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-800 transition-colors cursor-pointer"
              >
                {p.split(" for ")[0] || p}
              </button>
            ))}
          </div>
        </div>

        {/* Main Body: 2 Columns (Left: Live Preview Canvas, Right: Full Controls) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-0 flex-1 overflow-hidden">
          {/* Left Column: Live Preview Canvas (7 cols) */}
          <div className="lg:col-span-7 p-6 flex flex-col items-center justify-center bg-canvas/30 select-none overflow-y-auto">
            {/* Preview Background Toggles */}
            <div className="mb-3 flex items-center justify-between w-full max-w-lg text-xs">
              <span className="font-semibold text-muted flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                <Eye className="h-3.5 w-3.5 text-brand-600" />
                Live Preview
              </span>
              <div className="flex items-center gap-1 bg-surface border border-line rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setPreviewBg("photo")}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    previewBg === "photo"
                      ? "bg-brand-600 text-white shadow-xs"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  On Photo
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewBg("dark")}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    previewBg === "dark"
                      ? "bg-brand-600 text-white shadow-xs"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  Dark Canvas
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewBg("grid")}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    previewBg === "grid"
                      ? "bg-brand-600 text-white shadow-xs"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  Grid
                </button>
              </div>
            </div>

            {/* Canvas Container */}
            <div
              className={`relative w-full max-w-lg aspect-[16/10] rounded-2xl border border-line flex flex-col justify-end overflow-hidden shadow-inner transition-all ${
                previewBg === "photo"
                  ? "bg-cover bg-center"
                  : previewBg === "dark"
                  ? "bg-[#18181b]"
                  : "bg-[repeating-conic-gradient(#f0eee9_0%_25%,#ffffff_0%_50%)] bg-[length:14px_14px]"
              }`}
              style={{
                backgroundImage:
                  previewBg === "photo" ? "url(/default-cover.jpg)" : undefined,
              }}
            >
              {/* Dimmer overlay for photo preview */}
              {previewBg === "photo" && (
                <div className="absolute inset-0 bg-black/25 pointer-events-none" />
              )}

              {/* RENDERED SVG TEMPLATES (Positioned along bottom just like final photo) */}
              <div className="relative z-10 w-full flex items-end justify-center p-2">
                {preset === "classic-arched-banner" && (
                  <ClassicArchedBannerSVG
                    ref={svgRef}
                    subtitle={subtitle}
                    names={names}
                    dateText={dateText}
                    venueText={venueText}
                    fontFamily={fontFamily}
                    isItalic={isItalic}
                    namesFontSize={namesFontSize}
                    subtitleFontSize={subtitleFontSize}
                    dateFontSize={dateFontSize}
                    letterSpacing={letterSpacing}
                    arcHeight={arcHeight}
                    bgColor={bgColor}
                    textColor={textColor}
                    borderColor={borderColor}
                    showBorder={showBorder}
                    showCalendarIcon={showCalendarIcon}
                    showDividers={showDividers}
                    showVenue={showVenue}
                  />
                )}

                {preset === "minimalist-straight-banner" && (
                  <MinimalistStraightBannerSVG
                    ref={svgRef}
                    subtitle={subtitle}
                    names={names}
                    dateText={dateText}
                    venueText={venueText}
                    fontFamily={fontFamily}
                    isItalic={isItalic}
                    namesFontSize={namesFontSize}
                    subtitleFontSize={subtitleFontSize}
                    dateFontSize={dateFontSize}
                    letterSpacing={letterSpacing}
                    bgColor={bgColor}
                    textColor={textColor}
                    borderColor={borderColor}
                    showBorder={showBorder}
                    showCalendarIcon={showCalendarIcon}
                    showDividers={showDividers}
                    showVenue={showVenue}
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
                    dateFontSize={dateFontSize}
                    textColor={textColor}
                    borderColor={borderColor}
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
                    dateFontSize={dateFontSize}
                    textColor={textColor}
                    borderColor={borderColor}
                  />
                )}

                {preset === "transparent-signature" && (
                  <TransparentSignatureSVG
                    ref={svgRef}
                    subtitle={subtitle}
                    names={names}
                    dateText={dateText}
                    fontFamily={fontFamily}
                    isItalic={isItalic}
                    namesFontSize={namesFontSize}
                    subtitleFontSize={subtitleFontSize}
                    dateFontSize={dateFontSize}
                    letterSpacing={letterSpacing}
                    textColor={textColor}
                    showDividers={showDividers}
                  />
                )}
              </div>
            </div>

            <p className="mt-3 text-[11px] text-muted text-center">
              ✓ High-res vector render. Automatically attached to event watermark settings on apply.
            </p>
          </div>

          {/* Right Column: Customization Controls (5 cols) */}
          <div className="lg:col-span-5 p-6 space-y-5 overflow-y-auto max-h-[75vh]">
            {/* 1. Template Presets */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5 mb-2">
                <Layers className="h-3.5 w-3.5 text-brand-600" />
                <span>Template Style</span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPreset("classic-arched-banner");
                    setBgColor("#faf6ee");
                    setTextColor("#581c25");
                    setIsItalic(true);
                  }}
                  className={`flex flex-col text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                    preset === "classic-arched-banner"
                      ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500 shadow-xs"
                      : "border-line bg-surface hover:border-brand-300"
                  }`}
                >
                  <span className="text-xs font-bold text-ink">Classic Arched Banner</span>
                  <span className="text-[10px] text-muted mt-0.5">Flat cream curved bottom card (Photo match)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPreset("minimalist-straight-banner");
                    setBgColor("#faf6ee");
                    setTextColor("#581c25");
                  }}
                  className={`flex flex-col text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                    preset === "minimalist-straight-banner"
                      ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500 shadow-xs"
                      : "border-line bg-surface hover:border-brand-300"
                  }`}
                >
                  <span className="text-xs font-bold text-ink">Straight Flat Banner</span>
                  <span className="text-[10px] text-muted mt-0.5">Clean horizontal bottom bar with gold line</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPreset("royal-crest");
                    setTextColor("#dfb15b");
                  }}
                  className={`flex flex-col text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                    preset === "royal-crest"
                      ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500 shadow-xs"
                      : "border-line bg-surface hover:border-brand-300"
                  }`}
                >
                  <span className="text-xs font-bold text-ink">Royal Monogram Crest</span>
                  <span className="text-[10px] text-muted mt-0.5">Luxury heraldic shield with initials</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPreset("transparent-signature");
                    setTextColor("#ffffff");
                    setIsItalic(true);
                  }}
                  className={`flex flex-col text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                    preset === "transparent-signature"
                      ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500 shadow-xs"
                      : "border-line bg-surface hover:border-brand-300"
                  }`}
                >
                  <span className="text-xs font-bold text-ink">Transparent Signature</span>
                  <span className="text-[10px] text-muted mt-0.5">Overlay script without background box</span>
                </button>
              </div>
            </div>

            {/* 2. Text Content Fields */}
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
                  placeholder="THE WEDDING OF"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div>
                <span className="text-[11px] font-medium text-muted block mb-1">Couple / Person Names</span>
                <input
                  type="text"
                  value={names}
                  onChange={(e) => setNames(e.target.value)}
                  placeholder="Arun & Keerthana"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink font-semibold focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[11px] font-medium text-muted block mb-1">Date</span>
                  <input
                    type="text"
                    value={dateText}
                    onChange={(e) => setDateText(e.target.value)}
                    placeholder="14 FEBRUARY 2026"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <span className="text-[11px] font-medium text-muted block mb-1">Venue / Tagline</span>
                  <input
                    type="text"
                    value={venueText}
                    onChange={(e) => setVenueText(e.target.value)}
                    placeholder="Chennai, India"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>
            </div>

            {/* 3. Typography & Font Selection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <Sliders className="h-3.5 w-3.5 text-brand-600" />
                  <span>Typography</span>
                </label>
                <button
                  type="button"
                  onClick={() => setIsItalic(!isItalic)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                    isItalic
                      ? "border-brand-500 bg-brand-50 text-brand-700 font-bold"
                      : "border-line text-muted hover:text-ink"
                  }`}
                >
                  Italic Script ({isItalic ? "ON" : "OFF"})
                </button>
              </div>

              <div>
                <span className="text-[11px] font-medium text-muted block mb-1">Font Family</span>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value as typeof fontFamily)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
                >
                  <option value="Playfair Display">Playfair Display (Classic Luxury Wedding Serif - Photo match)</option>
                  <option value="Cormorant Garamond">Cormorant Garamond (Royal Elegant Serif)</option>
                  <option value="Cinzel">Cinzel (Imperial Roman Serif)</option>
                  <option value="Great Vibes">Great Vibes (Graceful Flowing Calligraphy)</option>
                  <option value="Alex Brush">Alex Brush (Delicate Luxury Script)</option>
                  <option value="Montserrat">Montserrat (Clean Modern Sans)</option>
                </select>
              </div>

              {/* FONT SIZING SLIDERS (Full range, directly modifies SVG) */}
              <div className="space-y-2.5 pt-1 bg-surface border border-line rounded-xl p-3">
                {/* Names Size */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-muted mb-1">
                    <span className="font-semibold text-ink">Names Font Size</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setNamesFontSize(Math.max(45, namesFontSize - 4))}
                        className="grid h-5 w-5 place-items-center rounded bg-canvas border border-line text-ink hover:bg-brand-50"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="font-mono text-ink font-bold w-10 text-center">{namesFontSize}px</span>
                      <button
                        type="button"
                        onClick={() => setNamesFontSize(Math.min(130, namesFontSize + 4))}
                        className="grid h-5 w-5 place-items-center rounded bg-canvas border border-line text-ink hover:bg-brand-50"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={45}
                    max={130}
                    value={namesFontSize}
                    onChange={(e) => setNamesFontSize(Number(e.target.value))}
                    className="w-full accent-brand-500 h-1.5 bg-line rounded-lg cursor-pointer"
                  />
                </div>

                {/* Subtitle Size */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-muted mb-1">
                    <span>Subtitle Size</span>
                    <span className="font-mono text-ink font-semibold">{subtitleFontSize}px</span>
                  </div>
                  <input
                    type="range"
                    min={12}
                    max={36}
                    value={subtitleFontSize}
                    onChange={(e) => setSubtitleFontSize(Number(e.target.value))}
                    className="w-full accent-brand-500 h-1.5 bg-line rounded-lg cursor-pointer"
                  />
                </div>

                {/* Date Size */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-muted mb-1">
                    <span>Date Size</span>
                    <span className="font-mono text-ink font-semibold">{dateFontSize}px</span>
                  </div>
                  <input
                    type="range"
                    min={12}
                    max={32}
                    value={dateFontSize}
                    onChange={(e) => setDateFontSize(Number(e.target.value))}
                    className="w-full accent-brand-500 h-1.5 bg-line rounded-lg cursor-pointer"
                  />
                </div>

                {/* Letter Spacing */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-muted mb-1">
                    <span>Letter Spacing</span>
                    <span className="font-mono text-ink font-semibold">{letterSpacing}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={14}
                    value={letterSpacing}
                    onChange={(e) => setLetterSpacing(Number(e.target.value))}
                    className="w-full accent-brand-500 h-1.5 bg-line rounded-lg cursor-pointer"
                  />
                </div>

                {/* Top Curve Arch Height (for arched banner) */}
                {preset === "classic-arched-banner" && (
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-muted mb-1">
                      <span>Top Arch Curve Height</span>
                      <span className="font-mono text-ink font-semibold">{arcHeight}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={65}
                      value={arcHeight}
                      onChange={(e) => setArcHeight(Number(e.target.value))}
                      className="w-full accent-brand-500 h-1.5 bg-line rounded-lg cursor-pointer"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* 4. Colors (Background & Text) */}
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5 text-brand-600" /> Color Themes
                </span>
              </label>

              {/* Banner Background Color (for banner styles) */}
              {(preset === "classic-arched-banner" || preset === "minimalist-straight-banner") && (
                <div>
                  <span className="text-[11px] font-medium text-muted block mb-1.5">
                    Banner Background Color
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[
                      { name: "Ivory Cream", val: "#faf6ee" },
                      { name: "Champagne", val: "#f6f0df" },
                      { name: "White", val: "#ffffff" },
                      { name: "Deep Maroon", val: "#4a141b" },
                      { name: "Midnight", val: "#141416" },
                      { name: "Transparent", val: "transparent" },
                    ].map((b) => (
                      <button
                        key={b.val}
                        type="button"
                        onClick={() => setBgColor(b.val)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-all cursor-pointer flex items-center gap-1.5 ${
                          bgColor === b.val
                            ? "border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500 font-bold"
                            : "border-line bg-surface text-ink hover:border-brand-300"
                        }`}
                      >
                        <span
                          className="h-3 w-3 rounded-full border border-black/10 shrink-0"
                          style={{
                            background:
                              b.val === "transparent"
                                ? "repeating-conic-gradient(#bbb 0% 25%, #fff 0% 50%) 50% / 6px 6px"
                                : b.val,
                          }}
                        />
                        <span>{b.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Text & Accent Color */}
              <div>
                <span className="text-[11px] font-medium text-muted block mb-1.5">
                  Text & Accent Color
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    { name: "Wine Burgundy", val: "#581c25" },
                    { name: "Warm Gold", val: "#c49b66" },
                    { name: "Royal Gold", val: "#996515" },
                    { name: "Matte Charcoal", val: "#1a1a1a" },
                    { name: "Pure White", val: "#ffffff" },
                  ].map((c) => (
                    <button
                      key={c.val}
                      type="button"
                      onClick={() => setTextColor(c.val)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-all cursor-pointer flex items-center gap-1.5 ${
                        textColor === c.val
                          ? "border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500 font-bold"
                          : "border-line bg-surface text-ink hover:border-brand-300"
                      }`}
                    >
                      <span
                        className="h-3 w-3 rounded-full border border-black/10 shrink-0"
                        style={{ background: c.val }}
                      />
                      <span>{c.name}</span>
                    </button>
                  ))}
                  {/* Custom color input */}
                  <label className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-line bg-surface text-[11px] text-ink cursor-pointer hover:border-brand-300">
                    <input
                      type="color"
                      value={textColor.startsWith("#") ? textColor : "#581c25"}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="h-3.5 w-3.5 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    <span>Custom</span>
                  </label>
                </div>
              </div>
            </div>

            {/* 5. Elements Toggles */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted block">
                Element Toggles
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showBorder}
                    onChange={(e) => setShowBorder(e.target.checked)}
                    className="accent-brand-600 rounded"
                  />
                  <span>Curved Top Border</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showCalendarIcon}
                    onChange={(e) => setShowCalendarIcon(e.target.checked)}
                    className="accent-brand-600 rounded"
                  />
                  <span>Calendar Icon</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showDividers}
                    onChange={(e) => setShowDividers(e.target.checked)}
                    className="accent-brand-600 rounded"
                  />
                  <span>Date Divider Lines</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showVenue}
                    onChange={(e) => setShowVenue(e.target.checked)}
                    className="accent-brand-600 rounded"
                  />
                  <span>Venue Tagline</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-line px-6 py-3.5 bg-canvas/40 shrink-0">
          <button
            type="button"
            onClick={() => {
              setNames("Arun & Keerthana");
              setSubtitle("THE WEDDING OF");
              setDateText("14 FEBRUARY 2026");
              setVenueText("The Grand Palace, Chennai");
              setBgColor("#faf6ee");
              setTextColor("#581c25");
              setFontFamily("Playfair Display");
              setIsItalic(true);
              setNamesFontSize(82);
              setSubtitleFontSize(20);
              setDateFontSize(18);
              setLetterSpacing(5);
              setArcHeight(45);
              setPreset("classic-arched-banner");
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

// ------------------------------------------------------------------------------------------------
// 1. CLASSIC ARCHED BOTTOM BANNER (PHOTO MATCH - IMAGE 2)
// ------------------------------------------------------------------------------------------------
interface ClassicArchedBannerSVGProps {
  subtitle: string;
  names: string;
  dateText: string;
  venueText?: string;
  fontFamily: string;
  isItalic: boolean;
  namesFontSize: number;
  subtitleFontSize: number;
  dateFontSize: number;
  letterSpacing: number;
  arcHeight?: number;
  bgColor: string;
  textColor: string;
  borderColor: string;
  showBorder: boolean;
  showCalendarIcon: boolean;
  showDividers: boolean;
  showVenue: boolean;
}

const ClassicArchedBannerSVG = ({
  ref,
  subtitle,
  names,
  dateText,
  venueText,
  fontFamily,
  isItalic,
  namesFontSize,
  subtitleFontSize,
  dateFontSize,
  letterSpacing,
  arcHeight = 45,
  bgColor,
  textColor,
  borderColor,
  showBorder,
  showCalendarIcon,
  showDividers,
  showVenue,
}: ClassicArchedBannerSVGProps & { ref: React.RefObject<SVGSVGElement | null> }) => {
  const bannerHeight = 280;
  const topY = 60 - arcHeight;
  const subtitleY = Math.max(topY + 36, 52);
  const namesY = subtitleY + namesFontSize * 0.95;
  const dateY = namesY + 44;
  const venueY = dateY + 28;

  const fontStack = `'${fontFamily}', 'Playfair Display', 'Cormorant Garamond', Georgia, serif`;

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 1200 ${bannerHeight}`}
      width="1200"
      height={bannerHeight}
      className="max-h-[260px] w-auto max-w-full drop-shadow-md"
      style={{ overflow: "visible" }}
    >
      <defs>
        <style>{GOOGLE_FONTS_DEF}</style>
      </defs>

      {/* Flat Background Card with Curved Top Arch (Exact Image 2 match) */}
      {bgColor !== "transparent" && (
        <path
          d={`M 0,60 Q 600,${topY} 1200,60 L 1200,${bannerHeight} L 0,${bannerHeight} Z`}
          fill={bgColor}
        />
      )}

      {/* Curved Double Hairline Border along top arch */}
      {showBorder && (
        <g stroke={borderColor || textColor} fill="none">
          {/* Outer primary arch hairline */}
          <path
            d={`M 0,60 Q 600,${topY} 1200,60`}
            strokeWidth="1.8"
            opacity="0.85"
          />
          {/* Inner secondary hairline */}
          <path
            d={`M 0,64 Q 600,${topY + 4} 1200,64`}
            strokeWidth="1"
            opacity="0.45"
          />
        </g>
      )}

      {/* 1. Subtitle: THE WEDDING OF */}
      <text
        x="600"
        y={subtitleY}
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: "'Cinzel', 'Playfair Display', Georgia, serif",
          fontSize: `${subtitleFontSize}px`,
          letterSpacing: `${letterSpacing}px`,
          fontWeight: 600,
          opacity: 0.9,
        }}
      >
        {subtitle.toUpperCase()}
      </text>

      {/* 2. Couple Names: Arun & Keerthana */}
      <text
        x="600"
        y={namesY}
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: fontStack,
          fontSize: `${namesFontSize}px`,
          fontStyle: isItalic ? "italic" : "normal",
          fontWeight: isItalic ? 500 : 600,
        }}
      >
        {names}
      </text>

      {/* 3. Date Row with Calendar Icon and Hairline Dividers: ─── 🗓 14 FEBRUARY 2026 ─── */}
      <g fill={textColor}>
        {showDividers && (
          <line
            x1="360"
            y1={dateY - 5}
            x2={showCalendarIcon ? "470" : "510"}
            y2={dateY - 5}
            stroke={textColor}
            strokeWidth="1"
            opacity="0.4"
          />
        )}

        {showCalendarIcon && (
          <g
            transform={`translate(488, ${dateY - 17}) scale(0.95)`}
            fill="none"
            stroke={textColor}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.85"
          >
            <rect x="0" y="3" width="16" height="15" rx="2.5" />
            <line x1="0" y1="8" x2="16" y2="8" />
            <line x1="4" y1="0.5" x2="4" y2="4.5" />
            <line x1="12" y1="0.5" x2="12" y2="4.5" />
            <circle cx="5" cy="12" r="0.8" fill={textColor} />
            <circle cx="8" cy="12" r="0.8" fill={textColor} />
            <circle cx="11" cy="12" r="0.8" fill={textColor} />
          </g>
        )}

        <text
          x="600"
          y={dateY}
          textAnchor="middle"
          fill={textColor}
          style={{
            fontFamily: "'Cinzel', 'Playfair Display', Georgia, serif",
            fontSize: `${dateFontSize}px`,
            letterSpacing: "3px",
            fontWeight: 600,
            opacity: 0.95,
          }}
        >
          {dateText.toUpperCase()}
        </text>

        {showDividers && (
          <line
            x1={showCalendarIcon ? "730" : "690"}
            y1={dateY - 5}
            x2="840"
            y2={dateY - 5}
            stroke={textColor}
            strokeWidth="1"
            opacity="0.4"
          />
        )}
      </g>

      {/* 4. Optional Venue Tagline */}
      {showVenue && venueText && (
        <text
          x="600"
          y={venueY}
          textAnchor="middle"
          fill={textColor}
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontSize: "13px",
            letterSpacing: "2.5px",
            fontWeight: 500,
            opacity: 0.75,
          }}
        >
          {venueText.toUpperCase()}
        </text>
      )}
    </svg>
  );
};

// ------------------------------------------------------------------------------------------------
// 2. MINIMALIST STRAIGHT BANNER
// ------------------------------------------------------------------------------------------------
const MinimalistStraightBannerSVG = ({
  ref,
  subtitle,
  names,
  dateText,
  venueText,
  fontFamily,
  isItalic,
  namesFontSize,
  subtitleFontSize,
  dateFontSize,
  letterSpacing,
  bgColor,
  textColor,
  borderColor,
  showBorder,
  showCalendarIcon,
  showDividers,
  showVenue,
}: ClassicArchedBannerSVGProps & { ref: React.RefObject<SVGSVGElement | null> }) => {
  const bannerHeight = 240;
  const subtitleY = 55;
  const namesY = subtitleY + namesFontSize * 0.95;
  const dateY = namesY + 44;
  const fontStack = `'${fontFamily}', 'Playfair Display', Georgia, serif`;

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 1200 ${bannerHeight}`}
      width="1200"
      height={bannerHeight}
      className="max-h-[240px] w-auto max-w-full drop-shadow-md"
      style={{ overflow: "visible" }}
    >
      <defs>
        <style>{GOOGLE_FONTS_DEF}</style>
      </defs>

      {bgColor !== "transparent" && (
        <rect x="0" y="0" width="1200" height={bannerHeight} fill={bgColor} />
      )}

      {showBorder && (
        <g stroke={borderColor || textColor}>
          <line x1="0" y1="2" x2="1200" y2="2" strokeWidth="2" opacity="0.8" />
          <line x1="0" y1="6" x2="1200" y2="6" strokeWidth="1" opacity="0.4" />
        </g>
      )}

      <text
        x="600"
        y={subtitleY}
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: "'Cinzel', 'Playfair Display', Georgia, serif",
          fontSize: `${subtitleFontSize}px`,
          letterSpacing: `${letterSpacing}px`,
          fontWeight: 600,
          opacity: 0.9,
        }}
      >
        {subtitle.toUpperCase()}
      </text>

      <text
        x="600"
        y={namesY}
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: fontStack,
          fontSize: `${namesFontSize}px`,
          fontStyle: isItalic ? "italic" : "normal",
          fontWeight: isItalic ? 500 : 600,
        }}
      >
        {names}
      </text>

      <g fill={textColor}>
        {showDividers && (
          <line x1="360" y1={dateY - 5} x2="470" y2={dateY - 5} stroke={textColor} strokeWidth="1" opacity="0.4" />
        )}
        {showCalendarIcon && (
          <g transform={`translate(488, ${dateY - 17}) scale(0.95)`} fill="none" stroke={textColor} strokeWidth="1.6">
            <rect x="0" y="3" width="16" height="15" rx="2.5" />
            <line x1="0" y1="8" x2="16" y2="8" />
          </g>
        )}
        <text
          x="600"
          y={dateY}
          textAnchor="middle"
          fill={textColor}
          style={{
            fontFamily: "'Cinzel', Georgia, serif",
            fontSize: `${dateFontSize}px`,
            letterSpacing: "3px",
            fontWeight: 600,
          }}
        >
          {dateText.toUpperCase()}
        </text>
        {showDividers && (
          <line x1="730" y1={dateY - 5} x2="840" y2={dateY - 5} stroke={textColor} strokeWidth="1" opacity="0.4" />
        )}
      </g>

      {/* Optional Venue Tagline */}
      {showVenue && venueText && (
        <text
          x="600"
          y={dateY + 28}
          textAnchor="middle"
          fill={textColor}
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontSize: "12px",
            letterSpacing: "2.5px",
            fontWeight: 500,
            opacity: 0.75,
          }}
        >
          {venueText.toUpperCase()}
        </text>
      )}
    </svg>
  );
};

// ------------------------------------------------------------------------------------------------
// 3. ROYAL MONOGRAM CREST
// ------------------------------------------------------------------------------------------------
const RoyalCrestSVG = ({
  ref,
  subtitle,
  names,
  dateText,
  fontFamily,
  namesFontSize,
  subtitleFontSize,
  dateFontSize,
  textColor,
  borderColor,
}: {
  ref: React.RefObject<SVGSVGElement | null>;
  subtitle: string;
  names: string;
  dateText: string;
  fontFamily: string;
  namesFontSize: number;
  subtitleFontSize: number;
  dateFontSize: number;
  textColor: string;
  borderColor: string;
}) => {
  const initials = names
    .split("&")
    .map((s) => s.trim()[0] || "")
    .join(" & ");

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 600 500"
      width="600"
      height="500"
      className="max-h-[260px] w-auto max-w-full drop-shadow-md"
      style={{ overflow: "visible" }}
    >
      <defs>
        <style>{GOOGLE_FONTS_DEF}</style>
      </defs>

      {/* Royal Crest Shield Frame */}
      <g stroke={borderColor || textColor} fill="none" strokeWidth="2" opacity="0.85">
        <path d="M 300,40 L 410,100 L 410,210 Q 410,310 300,360 Q 190,310 190,210 L 190,100 Z" />
        <path d="M 300,52 L 398,106 L 398,206 Q 398,296 300,344 Q 202,296 202,206 L 202,106 Z" strokeWidth="1" opacity="0.5" />
      </g>

      {/* Monogram Initials inside Shield */}
      <text
        x="300"
        y="215"
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: `'${fontFamily}', 'Playfair Display', serif`,
          fontSize: "64px",
          fontWeight: 600,
        }}
      >
        {initials || "A & K"}
      </text>

      {/* Subtitle */}
      <text
        x="300"
        y="405"
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: "'Cinzel', Georgia, serif",
          fontSize: `${subtitleFontSize}px`,
          letterSpacing: "4px",
          fontWeight: 600,
        }}
      >
        {subtitle.toUpperCase()}
      </text>

      {/* Names */}
      <text
        x="300"
        y="445"
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: `'${fontFamily}', 'Playfair Display', Georgia, serif`,
          fontSize: `${Math.min(namesFontSize, 48)}px`,
          fontWeight: 500,
        }}
      >
        {names}
      </text>

      {/* Date */}
      <text
        x="300"
        y="475"
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: "'Cinzel', Georgia, serif",
          fontSize: `${dateFontSize}px`,
          letterSpacing: "3px",
          fontWeight: 600,
          opacity: 0.85,
        }}
      >
        {dateText.toUpperCase()}
      </text>
    </svg>
  );
};

// ------------------------------------------------------------------------------------------------
// 4. REFINED BOTANICAL WREATH
// ------------------------------------------------------------------------------------------------
const BotanicalWreathSVG = ({
  ref,
  subtitle,
  names,
  dateText,
  fontFamily,
  namesFontSize,
  subtitleFontSize,
  dateFontSize,
  textColor,
  borderColor,
}: {
  ref: React.RefObject<SVGSVGElement | null>;
  subtitle: string;
  names: string;
  dateText: string;
  fontFamily: string;
  namesFontSize: number;
  subtitleFontSize: number;
  dateFontSize: number;
  textColor: string;
  borderColor: string;
}) => {
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 600 500"
      width="600"
      height="500"
      className="max-h-[260px] w-auto max-w-full drop-shadow-md"
      style={{ overflow: "visible" }}
    >
      <defs>
        <style>{GOOGLE_FONTS_DEF}</style>
      </defs>

      {/* Clean Symmetrical Laurel Wreath Ring */}
      <g stroke={borderColor || textColor} fill="none" strokeWidth="1.5" opacity="0.8">
        <circle cx="300" cy="220" r="140" strokeDasharray="6,4" />
        <path d="M 180,220 C 180,140 240,80 300,80 C 360,80 420,140 420,220 C 420,300 360,360 300,360" />
      </g>

      <text
        x="300"
        y="180"
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: "'Cinzel', Georgia, serif",
          fontSize: `${subtitleFontSize}px`,
          letterSpacing: "4px",
          fontWeight: 600,
        }}
      >
        {subtitle.toUpperCase()}
      </text>

      <text
        x="300"
        y="230"
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: `'${fontFamily}', 'Playfair Display', serif`,
          fontSize: `${Math.min(namesFontSize, 52)}px`,
          fontStyle: "italic",
          fontWeight: 600,
        }}
      >
        {names}
      </text>

      <text
        x="300"
        y="275"
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: "'Cinzel', Georgia, serif",
          fontSize: `${dateFontSize}px`,
          letterSpacing: "3px",
          fontWeight: 600,
        }}
      >
        {dateText.toUpperCase()}
      </text>
    </svg>
  );
};

// ------------------------------------------------------------------------------------------------
// 5. TRANSPARENT LUXURY SIGNATURE
// ------------------------------------------------------------------------------------------------
const TransparentSignatureSVG = ({
  ref,
  subtitle,
  names,
  dateText,
  fontFamily,
  isItalic,
  namesFontSize,
  subtitleFontSize,
  dateFontSize,
  letterSpacing,
  textColor,
  showDividers,
}: {
  ref: React.RefObject<SVGSVGElement | null>;
  subtitle: string;
  names: string;
  dateText: string;
  fontFamily: string;
  isItalic: boolean;
  namesFontSize: number;
  subtitleFontSize: number;
  dateFontSize: number;
  letterSpacing: number;
  textColor: string;
  showDividers: boolean;
}) => {
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1000 240"
      width="1000"
      height="240"
      className="max-h-[220px] w-auto max-w-full drop-shadow-lg"
      style={{ overflow: "visible" }}
    >
      <defs>
        <style>{GOOGLE_FONTS_DEF}</style>
      </defs>

      <text
        x="500"
        y="50"
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: "'Cinzel', 'Playfair Display', Georgia, serif",
          fontSize: `${subtitleFontSize}px`,
          letterSpacing: `${letterSpacing}px`,
          fontWeight: 600,
          opacity: 0.9,
        }}
      >
        {subtitle.toUpperCase()}
      </text>

      <text
        x="500"
        y="125"
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: `'${fontFamily}', 'Playfair Display', Georgia, serif`,
          fontSize: `${namesFontSize}px`,
          fontStyle: isItalic ? "italic" : "normal",
          fontWeight: 500,
        }}
      >
        {names}
      </text>

      {showDividers && (
        <line x1="300" y1="155" x2="700" y2="155" stroke={textColor} strokeWidth="1" opacity="0.4" />
      )}

      <text
        x="500"
        y="190"
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: "'Cinzel', Georgia, serif",
          fontSize: `${dateFontSize}px`,
          letterSpacing: "4px",
          fontWeight: 600,
          opacity: 0.9,
        }}
      >
        {dateText.toUpperCase()}
      </text>
    </svg>
  );
};
