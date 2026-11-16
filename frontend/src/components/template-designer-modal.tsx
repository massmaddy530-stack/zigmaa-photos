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
  | "minimalist-straight-banner" // Clean flat horizontal bar with gold accent line
  | "transparent-signature"; // Transparent luxury script watermark

export type SupportedFontFamily =
  | "Playfair Display"
  | "Cormorant Garamond"
  | "Bodoni Moda"
  | "Prata"
  | "Cinzel"
  | "Cinzel Decorative"
  | "Marcellus"
  | "Great Vibes"
  | "Alex Brush"
  | "Parisienne"
  | "Italianno"
  | "Pinyon Script"
  | "Allura"
  | "Dancing Script"
  | "Montserrat";

const GOOGLE_FONTS_DEF = `
@import url('https://fonts.googleapis.com/css2?family=Alex+Brush&family=Allura&family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..700;1,6..96,400..700&family=Cinzel+Decorative:wght@700&family=Cinzel:wght@400;600;700&family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,400;1,600;1,700&family=Dancing+Script:wght@600;700&family=Great+Vibes&family=Italianno&family=Marcellus&family=Montserrat:wght@400;500;600;700&family=Parisienne&family=Pinyon+Script&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&family=Prata&display=swap');
`;

function getRenderedCustomSvg(
  baseSvg: string,
  params: {
    names: string;
    subtitle: string;
    dateText: string;
    fontFamily: string;
    isItalic: boolean;
    namesFontSize: number;
    subtitleFontSize: number;
    dateFontSize: number;
    textColor: string;
    bgColor: string;
  }
): string {
  let svg = baseSvg;

  // 1. Update Names
  if (params.names) {
    svg = svg.replace(
      /(<text[^>]*id=["']svg-names["'][^>]*>)([\s\S]*?)(<\/text>)/i,
      (_match, open, _oldText, close) => {
        let updatedOpen = open;
        if (params.fontFamily) {
          updatedOpen = updatedOpen.replace(
            /font-family=["'][^"']*["']/i,
            `font-family="'${params.fontFamily}', serif"`
          );
        }
        if (params.namesFontSize) {
          updatedOpen = updatedOpen.replace(
            /font-size=["'][^"']*["']/i,
            `font-size="${params.namesFontSize}"`
          );
        }
        if (typeof params.isItalic === "boolean") {
          if (updatedOpen.includes("font-style=")) {
            updatedOpen = updatedOpen.replace(
              /font-style=["'][^"']*["']/i,
              `font-style="${params.isItalic ? "italic" : "normal"}"`
            );
          } else {
            updatedOpen = updatedOpen.replace(
              /<text/i,
              `<text font-style="${params.isItalic ? "italic" : "normal"}"`
            );
          }
        }
        return `${updatedOpen}${params.names}${close}`;
      }
    );
  }

  // 2. Update Subtitle
  if (params.subtitle) {
    svg = svg.replace(
      /(<text[^>]*id=["']svg-subtitle["'][^>]*>)([\s\S]*?)(<\/text>)/i,
      (_match, open, _oldText, close) => {
        let updatedOpen = open;
        if (params.subtitleFontSize) {
          updatedOpen = updatedOpen.replace(
            /font-size=["'][^"']*["']/i,
            `font-size="${params.subtitleFontSize}"`
          );
        }
        return `${updatedOpen}${params.subtitle}${close}`;
      }
    );
  }

  // 3. Update Date
  if (params.dateText) {
    svg = svg.replace(
      /(<text[^>]*id=["']svg-date["'][^>]*>)([\s\S]*?)(<\/text>)/i,
      (_match, open, _oldText, close) => {
        let updatedOpen = open;
        if (params.dateFontSize) {
          updatedOpen = updatedOpen.replace(
            /font-size=["'][^"']*["']/i,
            `font-size="${params.dateFontSize}"`
          );
        }
        return `${updatedOpen}${params.dateText}${close}`;
      }
    );
  }

  // 4. Update Background Color if set
  if (params.bgColor) {
    if (params.bgColor === "transparent") {
      svg = svg.replace(/(<(?:rect|path)[^>]*id=["']svg-bg["'][^>]*)/i, `$1 opacity="0" `);
    } else {
      svg = svg.replace(
        /(<(?:rect|path)[^>]*id=["']svg-bg["'][^>]*?)(fill=["'][^"']*["'])/i,
        `$1fill="${params.bgColor}" opacity="1"`
      );
    }
  }

  return svg;
}

export function TemplateDesignerModal({
  isOpen,
  onClose,
  onApplyTemplate,
  defaultEventName = "",
  defaultEventDate = "",
}: TemplateDesignerModalProps) {
  // Preset selection - Default to Straight Flat Banner
  const [preset, setPreset] = useState<TemplatePreset>("minimalist-straight-banner");

  // Text content
  const [subtitle, setSubtitle] = useState("THE WEDDING OF");
  const [names, setNames] = useState("Arun & Keerthana");
  const [dateText, setDateText] = useState("14 FEBRUARY 2026");
  const [venueText, setVenueText] = useState("The Grand Palace, Chennai");

  // Typography options
  const [fontFamily, setFontFamily] = useState<SupportedFontFamily>("Playfair Display");
  const [isItalic, setIsItalic] = useState(true);

  // Font size sliders with high, realistic pixel ranges for 1200px vector canvas
  const [namesFontSize, setNamesFontSize] = useState(82); // px (45 - 130)
  const [subtitleFontSize, setSubtitleFontSize] = useState(20); // px (12 - 36)
  const [dateFontSize, setDateFontSize] = useState(18); // px (12 - 32)

  // Colors
  const [bgColor, setBgColor] = useState("#faf6ee"); // Flat Warm Ivory Cream
  const [textColor, setTextColor] = useState("#581c25"); // Deep Burgundy / Wine
  const [borderColor] = useState("#c49b66"); // Subtle Luxury Gold Border

  // Toggles
  const [showBorder] = useState(true);
  const [showDividers] = useState(true);
  const [showVenue] = useState(false);

  // Gemini AI Prompt Bar state
  const toast = useToast();
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  // SVG ref for exporting to PNG
  const svgRef = useRef<SVGSVGElement>(null);

  // AI Dynamic Custom SVG state
  const [isCustomAi, setIsCustomAi] = useState(false);
  const [customSvgRaw, setCustomSvgRaw] = useState<string | null>(null);
  const [themeName, setThemeName] = useState<string>("");
  const customContainerRef = useRef<HTMLDivElement>(null);

  // Handle AI Template Generation with Gemini / OpenAI
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
      if (data.ok) {
        if (data.isCustomSvg && data.svg) {
          setIsCustomAi(true);
          setCustomSvgRaw(data.svg);
          if (data.themeName) setThemeName(data.themeName);
          if (data.names) setNames(data.names);
          if (data.subtitle) setSubtitle(data.subtitle);
          if (data.dateText) setDateText(data.dateText);
          if (data.venueText) setVenueText(data.venueText);
          if (data.fontFamily) setFontFamily(data.fontFamily as SupportedFontFamily);
          if (data.textColor) setTextColor(data.textColor);
          if (data.bgColor) setBgColor(data.bgColor);
          toast.success("AI Graphic Generated!", `Custom ${data.themeName || "template"} created for "${data.names || text}"`);
        } else if (data.template) {
          const t = data.template;
          setIsCustomAi(false);
          if (t.preset === "transparent-signature") setPreset("transparent-signature");
          else setPreset("minimalist-straight-banner");
          if (t.subtitle) setSubtitle(t.subtitle);
          if (t.names) setNames(t.names);
          if (t.dateText) setDateText(t.dateText);
          if (t.venueText) setVenueText(t.venueText);
          if (t.fontFamily) setFontFamily(t.fontFamily as SupportedFontFamily);
          if (typeof t.isItalic === "boolean") setIsItalic(t.isItalic);
          if (typeof t.namesFontSize === "number") setNamesFontSize(t.namesFontSize);
          if (typeof t.subtitleFontSize === "number") setSubtitleFontSize(t.subtitleFontSize);
          if (typeof t.dateFontSize === "number") setDateFontSize(t.dateFontSize);
          if (t.bgColor) setBgColor(t.bgColor);
          if (t.textColor) setTextColor(t.textColor);

          toast.success("AI Template Generated!", `Design updated for "${t.names}"`);
        }
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
    let svgElement: SVGSVGElement | null = null;
    if (isCustomAi && customContainerRef.current) {
      svgElement = customContainerRef.current.querySelector("svg");
    } else {
      svgElement = svgRef.current;
    }
    if (!svgElement) return;

    try {
      const width = parseInt(svgElement.getAttribute("width") || "1200", 10);
      const height = parseInt(svgElement.getAttribute("height") || "240", 10);

      const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
      svgClone.setAttribute("width", String(width));
      svgClone.setAttribute("height", String(height));

      const svgString = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const blobUrl = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(blobUrl);
            if (!blob) {
              toast.error("Render failed", "Could not export template bitmap.");
              return;
            }

            const file = new File([blob], "custom-template-watermark.png", {
              type: "image/png",
            });
            const dataUrl = canvas.toDataURL("image/png");

            const result: GeneratedTemplateResult = {
              id: `tpl-${Date.now()}`,
              name: isCustomAi
                ? `AI Template (${themeName || "Custom"})`
                : preset === "minimalist-straight-banner"
                ? "Straight Flat Banner"
                : "Transparent Signature",
              preview: dataUrl,
              dataUrl,
              sizeBytes: blob.size,
              file,
              xPercent: 50,
              yPercent: 88,
              sizePercent: 100,
              opacity: 100,
            };

            onApplyTemplate(result);
            toast.success(
              "Template Applied!",
              "Your high-resolution vector watermark is now attached to this event."
            );
            onClose();
          },
          "image/png",
          1.0
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        toast.error("Export failed", "Failed to rasterize SVG design.");
      };

      img.src = blobUrl;
    } catch (err) {
      console.error("Export error:", err);
      toast.error("Export failed", "Could not process template watermark.");
    }
  }

  return (
    <Modal open={isOpen} onClose={onClose} size="xl" bare>
      <div className="relative w-full max-h-[92vh] flex flex-col bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4 bg-canvas/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 border border-brand-200 text-brand-600">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">Customize Template</h2>
              <p className="text-xs text-muted">
                Design classic flat banners or transparent watermark templates with custom fonts and colors.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-ink hover:bg-canvas transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* AI Template Prompt Bar */}
        <div className="border-b border-line bg-gradient-to-r from-brand-50/70 via-surface to-amber-50/50 px-6 py-3 space-y-2 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-500" />
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isGenerating) {
                    e.preventDefault();
                    handleAiGenerate();
                  }
                }}
                placeholder="Ask AI to generate any template (e.g. background bubble template, flowers, balloons, luxury banner)..."
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
              "Background bubble template for Rithvik birthday 17-11-2026",
              "Flower template with elegant roses for Naveen & Meera wedding 24 Dec 2026",
              "Festive party balloons with confetti for Birthday Celebration",
              "Straight flat ivory banner for Arun & Keerthana 14 Feb 2026",
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
            {/* Preview Header: Grid Only View */}
            <div className="mb-3 flex items-center justify-between w-full max-w-lg text-xs">
              <span className="font-semibold text-muted flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                <Eye className="h-3.5 w-3.5 text-brand-600" />
                Live Preview (Transparent Grid)
              </span>
              <span className="text-[10px] text-muted bg-surface border border-line px-2.5 py-0.5 rounded-md font-medium">
                Grid View
              </span>
            </div>

            {/* Canvas Container: Grid Only View */}
            <div
              className="relative w-full max-w-lg aspect-[16/10] rounded-2xl border border-line flex flex-col justify-end overflow-hidden shadow-inner bg-[repeating-conic-gradient(#f0eee9_0%_25%,#ffffff_0%_50%)] bg-[length:14px_14px]"
            >
              {/* RENDERED SVG TEMPLATES */}
              <div className="relative z-10 w-full flex items-end justify-center p-2">
                {isCustomAi && customSvgRaw ? (
                  <div
                    ref={customContainerRef}
                    className="w-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-h-[220px] [&>svg]:drop-shadow-lg"
                    dangerouslySetInnerHTML={{
                      __html: getRenderedCustomSvg(customSvgRaw, {
                        names,
                        subtitle,
                        dateText,
                        fontFamily,
                        isItalic,
                        namesFontSize,
                        subtitleFontSize,
                        dateFontSize,
                        textColor,
                        bgColor,
                      }),
                    }}
                  />
                ) : (
                  <>
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
                        bgColor={bgColor}
                        textColor={textColor}
                        borderColor={borderColor}
                        showBorder={showBorder}
                        showDividers={showDividers}
                        showVenue={showVenue}
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
                        textColor={textColor}
                        showDividers={showDividers}
                      />
                    )}
                  </>
                )}
              </div>
            </div>

            <p className="mt-3 text-[11px] text-muted text-center">
              ✓ High-res vector render. Automatically attached to event watermark settings on apply.
            </p>
          </div>

          {/* Right Column: Customization Controls (5 cols) */}
          <div className="lg:col-span-5 p-6 space-y-5 overflow-y-auto max-h-[75vh]">
            {/* AI Custom Active Banner */}
            {isCustomAi && (
              <div className="rounded-xl border border-brand-300 bg-brand-50/80 p-3 flex items-center justify-between shadow-xs">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand-600 animate-pulse shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-brand-900">
                      ✨ AI Custom Graphic: {themeName || "Generated Artwork"}
                    </div>
                    <div className="text-[10px] text-brand-700">
                      Live vector rendering based on prompt. You can customize text and fonts below.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCustomAi(false)}
                  className="shrink-0 text-[11px] font-semibold text-brand-700 hover:text-brand-900 bg-white border border-brand-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                >
                  Use Presets
                </button>
              </div>
            )}

            {/* 1. Template Presets (Straight Flat & Transparent Only) */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5 mb-2">
                <Layers className="h-3.5 w-3.5 text-brand-600" />
                <span>Template Style</span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomAi(false);
                    setPreset("minimalist-straight-banner");
                    setBgColor("#faf6ee");
                    setTextColor("#581c25");
                  }}
                  className={`flex flex-col text-left p-3 rounded-xl border transition-all cursor-pointer ${
                    !isCustomAi && preset === "minimalist-straight-banner"
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
                    setIsCustomAi(false);
                    setPreset("transparent-signature");
                    setBgColor("transparent");
                    setTextColor("#ffffff");
                    setIsItalic(true);
                  }}
                  className={`flex flex-col text-left p-3 rounded-xl border transition-all cursor-pointer ${
                    !isCustomAi && preset === "transparent-signature"
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

              {/* Font Family Selection with Expanded Luxury & Script Fonts */}
              <div>
                <span className="text-[11px] font-medium text-muted block mb-1">Font Family</span>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value as SupportedFontFamily)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
                >
                  <optgroup label="Luxury Classical Serifs">
                    <option value="Playfair Display">Playfair Display (Classic Luxury Wedding Serif)</option>
                    <option value="Cormorant Garamond">Cormorant Garamond (Royal Classical Serif)</option>
                    <option value="Bodoni Moda">Bodoni Moda (High Fashion Vogue Serif)</option>
                    <option value="Prata">Prata (Refined Elegant Didone Serif)</option>
                    <option value="Cinzel">Cinzel (Imperial Roman Serif)</option>
                    <option value="Cinzel Decorative">Cinzel Decorative (Ornate Classical Display)</option>
                    <option value="Marcellus">Marcellus (Subtle Flare Roman Serif)</option>
                  </optgroup>
                  <optgroup label="Elegant Calligraphy & Scripts">
                    <option value="Great Vibes">Great Vibes (Graceful Flowing Calligraphy)</option>
                    <option value="Alex Brush">Alex Brush (Delicate Luxury Script)</option>
                    <option value="Parisienne">Parisienne (Romantic French Cursive)</option>
                    <option value="Italianno">Italianno (Slanted Elegant Flourish)</option>
                    <option value="Pinyon Script">Pinyon Script (Vintage French Calligraphy)</option>
                    <option value="Allura">Allura (Soft Ribbon Calligraphy)</option>
                    <option value="Dancing Script">Dancing Script (Casual Lively Script)</option>
                  </optgroup>
                  <optgroup label="Modern Sans-Serif">
                    <option value="Montserrat">Montserrat (Clean Minimalist Sans)</option>
                  </optgroup>
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
              </div>
            </div>

            {/* 4. Colors (Background & Text) */}
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5 text-brand-600" /> Color Themes
                </span>
              </label>

              {/* Banner Background Color */}
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
                  {/* Custom Background Color Picker */}
                  <label className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-line bg-surface text-[11px] text-ink cursor-pointer hover:border-brand-300">
                    <input
                      type="color"
                      value={bgColor.startsWith("#") ? bgColor : "#faf6ee"}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="h-3.5 w-3.5 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    <span>Custom</span>
                  </label>
                </div>
              </div>

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
              setPreset("minimalist-straight-banner");
              setIsCustomAi(false);
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
// 1. STRAIGHT FLAT BANNER (Clean, horizontal bottom bar with gold accent line & NO calendar icon)
// ------------------------------------------------------------------------------------------------
interface MinimalistStraightBannerSVGProps {
  ref: React.RefObject<SVGSVGElement | null>;
  subtitle: string;
  names: string;
  dateText: string;
  venueText?: string;
  fontFamily: string;
  isItalic: boolean;
  namesFontSize: number;
  subtitleFontSize: number;
  dateFontSize: number;
  bgColor: string;
  textColor: string;
  borderColor?: string;
  showBorder?: boolean;
  showDividers?: boolean;
  showVenue?: boolean;
}

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
  bgColor,
  textColor,
  borderColor,
  showBorder = true,
  showDividers = true,
  showVenue = false,
}: MinimalistStraightBannerSVGProps) => {
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
        <rect id="svg-bg" x="0" y="0" width="1200" height={bannerHeight} fill={bgColor} />
      )}

      {showBorder && (
        <g stroke={borderColor || textColor}>
          <line x1="0" y1="2" x2="1200" y2="2" strokeWidth="2" opacity="0.8" />
          <line x1="0" y1="6" x2="1200" y2="6" strokeWidth="1" opacity="0.4" />
        </g>
      )}

      <text
        id="svg-subtitle"
        x="600"
        y={subtitleY}
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: "'Cinzel', 'Playfair Display', Georgia, serif",
          fontSize: `${subtitleFontSize}px`,
          letterSpacing: "4px",
          fontWeight: 600,
          opacity: 0.9,
        }}
      >
        {subtitle.toUpperCase()}
      </text>

      <text
        id="svg-names"
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
          <line x1="380" y1={dateY - 5} x2="475" y2={dateY - 5} stroke={textColor} strokeWidth="1" opacity="0.4" />
        )}
        <text
          id="svg-date"
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
          <line x1="725" y1={dateY - 5} x2="820" y2={dateY - 5} stroke={textColor} strokeWidth="1" opacity="0.4" />
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
// 2. TRANSPARENT SIGNATURE (Clean overlay script watermark without background box)
// ------------------------------------------------------------------------------------------------
interface TransparentSignatureSVGProps {
  ref: React.RefObject<SVGSVGElement | null>;
  subtitle: string;
  names: string;
  dateText: string;
  fontFamily: string;
  isItalic: boolean;
  namesFontSize: number;
  subtitleFontSize: number;
  dateFontSize: number;
  textColor: string;
  showDividers?: boolean;
}

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
  textColor,
  showDividers = true,
}: TransparentSignatureSVGProps) => {
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
        id="svg-subtitle"
        x="500"
        y="50"
        textAnchor="middle"
        fill={textColor}
        style={{
          fontFamily: "'Cinzel', 'Playfair Display', Georgia, serif",
          fontSize: `${subtitleFontSize}px`,
          letterSpacing: "4px",
          fontWeight: 600,
          opacity: 0.9,
        }}
      >
        {subtitle.toUpperCase()}
      </text>

      <text
        id="svg-names"
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
        id="svg-date"
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
