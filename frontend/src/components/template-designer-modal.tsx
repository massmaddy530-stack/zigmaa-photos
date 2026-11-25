"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  Check,
  Eye,
  Palette,
  RotateCcw,
  Sliders,
  Type,
  X,
  Minus,
  Plus,
} from "lucide-react";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { useToast } from "./ui/toast";
import {
  EVENT_TEMPLATES,
  EventTemplateItem,
  TemplateRenderParams,
} from "@/lib/templates/event-templates";

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

export function TemplateDesignerModal({
  isOpen,
  onClose,
  onApplyTemplate,
  defaultEventName = "",
  defaultEventDate = "",
}: TemplateDesignerModalProps) {
  // Current active template item - default is always "wed-straight-flat" (Straight Flat Ivory Banner)
  const activeTemplate = useMemo(() => {
    return (
      EVENT_TEMPLATES.find((t) => t.id === "wed-straight-flat") ||
      EVENT_TEMPLATES[0]
    );
  }, []);

  // Text content
  const [subtitle, setSubtitle] = useState("THE WEDDING OF");
  const [names, setNames] = useState("Arun & Keerthana");
  const [dateText, setDateText] = useState("14 FEBRUARY 2026");
  const [venueText, setVenueText] = useState("The Grand Palace, Chennai");

  // Typography options
  const [fontFamily, setFontFamily] = useState<SupportedFontFamily>("Playfair Display");
  const [isItalic, setIsItalic] = useState(true);

  // Font size sliders with high, realistic pixel ranges for 1200px vector canvas
  const [namesFontSize, setNamesFontSize] = useState(72); // px (45 - 130)
  const [subtitleFontSize, setSubtitleFontSize] = useState(18); // px (12 - 36)
  const [dateFontSize, setDateFontSize] = useState(16); // px (12 - 32)

  // Colors
  const [bgColor, setBgColor] = useState("#faf6ee");
  const [textColor, setTextColor] = useState("#581c25");

  const toast = useToast();

  // Refs for rendering
  const svgContainerRef = useRef<HTMLDivElement>(null);

  // Use event name if provided
  useEffect(() => {
    if (!defaultEventName) return;
    setNames(defaultEventName.trim());
  }, [defaultEventName]);

  // Format default event date if provided
  useEffect(() => {
    if (!defaultEventDate) return;
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
  }, [defaultEventDate]);

  // When resetting or applying template attributes
  function handleSelectTemplate(tpl: EventTemplateItem) {
    setSubtitle(tpl.defaultSubtitle);
    setFontFamily(tpl.defaultFontFamily as SupportedFontFamily);
    if (typeof tpl.isItalic === "boolean") setIsItalic(tpl.isItalic);
    setBgColor(tpl.defaultBgColor);
    setTextColor(tpl.defaultTextColor);
    if (tpl.defaultVenue) setVenueText(tpl.defaultVenue);
  }

  // Export SVG to high-res PNG and apply as watermark
  async function handleApply() {
    if (!svgContainerRef.current) return;
    const svgElement = svgContainerRef.current.querySelector("svg");
    if (!svgElement) return;

    try {
      const width = parseInt(svgElement.getAttribute("width") || "1200", 10);
      const height = parseInt(svgElement.getAttribute("height") || "240", 10);

      const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
      svgClone.setAttribute("width", String(width));
      svgClone.setAttribute("height", String(height));

      // Inject Google Fonts style into clone for high-res rasterization
      let defs = svgClone.querySelector("defs");
      if (!defs) {
        defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        svgClone.insertBefore(defs, svgClone.firstChild);
      }
      const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
      styleEl.textContent = GOOGLE_FONTS_DEF;
      defs.appendChild(styleEl);

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
              name: activeTemplate.name,
              preview: dataUrl,
              dataUrl,
              sizeBytes: blob.size,
              file,
              xPercent: 50,
              yPercent: 88,
              sizePercent: 100,
              opacity: 1.0,
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

  // Render SVG string for active state
  const renderedSvgString = useMemo(() => {
    const params: TemplateRenderParams = {
      names,
      subtitle,
      dateText,
      venueText,
      fontFamily,
      isItalic,
      namesFontSize,
      subtitleFontSize,
      dateFontSize,
      textColor,
      bgColor,
    };

    return activeTemplate.getSvg(params);
  }, [
    activeTemplate,
    names,
    subtitle,
    dateText,
    venueText,
    fontFamily,
    isItalic,
    namesFontSize,
    subtitleFontSize,
    dateFontSize,
    textColor,
    bgColor,
  ]);

  return (
    <Modal open={isOpen} onClose={onClose} size="xl" bare>
      <div className="relative w-full max-h-[92vh] flex flex-col bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-3.5 bg-canvas/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 border border-brand-200 text-brand-600">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">Watermark Template Studio</h2>
              <p className="text-xs text-muted">
                Straight Flat Ivory Banner default. Customize typography and colors.
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

        {/* Main Body: 2 Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-0 flex-1 overflow-hidden">
          {/* Left Column: Live Preview Canvas (7 cols) */}
          <div className="lg:col-span-7 p-5 flex flex-col items-center justify-center bg-canvas/30 select-none overflow-y-auto">
            {/* Preview Header: Grid Only View */}
            <div className="mb-2 flex items-center justify-between w-full max-w-lg text-xs">
              <span className="font-semibold text-muted flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                <Eye className="h-3.5 w-3.5 text-brand-600" />
                Live Preview (Transparent Grid)
              </span>
              <span className="text-[10px] text-muted bg-surface border border-line px-2 py-0.5 rounded-md font-medium">
                {`${activeTemplate.name} (Vector)`}
              </span>
            </div>

            {/* Canvas Container: Grid Only View */}
            <div className="relative w-full max-w-lg aspect-[16/10] rounded-2xl border border-line flex flex-col justify-end overflow-hidden shadow-inner bg-[repeating-conic-gradient(#f0eee9_0%_25%,#ffffff_0%_50%)] bg-[length:14px_14px]">
              {/* RENDERED SVG TEMPLATE */}
              <div className="relative z-10 w-full flex items-end justify-center p-2">
                <div
                  ref={svgContainerRef}
                  className="w-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-h-[220px] [&>svg]:drop-shadow-lg"
                  dangerouslySetInnerHTML={{ __html: renderedSvgString }}
                />
              </div>
            </div>

            <p className="mt-2 text-[11px] text-muted text-center">
              ✓ High-res vector render. Automatically attached to event watermark settings on apply.
            </p>
          </div>

          {/* Right Column: Controls (5 cols) */}
          <div className="lg:col-span-5 p-5 space-y-4 overflow-y-auto max-h-[75vh]">

            {/* Text Content Fields */}
            <div className="space-y-2.5 pt-1">
              <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                <Type className="h-3.5 w-3.5 text-brand-600" />
                <span>Text Details</span>
              </label>

              <div>
                <span className="text-[10px] font-medium text-muted block mb-1">Top Subtitle</span>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="THE WEDDING OF"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div>
                <span className="text-[10px] font-medium text-muted block mb-1">Names / Event Title</span>
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
                  <span className="text-[10px] font-medium text-muted block mb-1">Date</span>
                  <input
                    type="text"
                    value={dateText}
                    onChange={(e) => setDateText(e.target.value)}
                    placeholder="14 FEBRUARY 2026"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-medium text-muted block mb-1">Venue / Tagline</span>
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

            {/* 4. Typography & Font Selection */}
            <div className="space-y-2.5 pt-1 border-t border-line">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <Sliders className="h-3.5 w-3.5 text-brand-600" />
                  <span>Typography</span>
                </label>
                <button
                  type="button"
                  onClick={() => setIsItalic(!isItalic)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                    isItalic
                      ? "border-brand-500 bg-brand-50 text-brand-700 font-bold"
                      : "border-line text-muted hover:text-ink"
                  }`}
                >
                  Italic Script ({isItalic ? "ON" : "OFF"})
                </button>
              </div>

              {/* Font Family Selection */}
              <div>
                <span className="text-[10px] font-medium text-muted block mb-1">Font Family</span>
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

              {/* Font Sizing Sliders */}
              <div className="space-y-2 pt-1 bg-surface border border-line rounded-xl p-2.5">
                <div>
                  <div className="flex items-center justify-between text-[10px] text-muted mb-1">
                    <span className="font-semibold text-ink">Names Font Size</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setNamesFontSize(Math.max(45, namesFontSize - 4))}
                        className="grid h-4 w-4 place-items-center rounded bg-canvas border border-line text-ink hover:bg-brand-50"
                      >
                        <Minus className="h-2.5 w-2.5" />
                      </button>
                      <span className="font-mono text-ink font-bold w-8 text-center">{namesFontSize}px</span>
                      <button
                        type="button"
                        onClick={() => setNamesFontSize(Math.min(130, namesFontSize + 4))}
                        className="grid h-4 w-4 place-items-center rounded bg-canvas border border-line text-ink hover:bg-brand-50"
                      >
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={45}
                    max={130}
                    value={namesFontSize}
                    onChange={(e) => setNamesFontSize(Number(e.target.value))}
                    className="w-full accent-brand-500 h-1 bg-line rounded-lg cursor-pointer"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-muted mb-1">
                      <span>Subtitle Size</span>
                      <span className="font-mono text-ink font-semibold">{subtitleFontSize}px</span>
                    </div>
                    <input
                      type="range"
                      min={12}
                      max={32}
                      value={subtitleFontSize}
                      onChange={(e) => setSubtitleFontSize(Number(e.target.value))}
                      className="w-full accent-brand-500 h-1 bg-line rounded-lg cursor-pointer"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-muted mb-1">
                      <span>Date Size</span>
                      <span className="font-mono text-ink font-semibold">{dateFontSize}px</span>
                    </div>
                    <input
                      type="range"
                      min={12}
                      max={30}
                      value={dateFontSize}
                      onChange={(e) => setDateFontSize(Number(e.target.value))}
                      className="w-full accent-brand-500 h-1 bg-line rounded-lg cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 5. Colors (Background & Text) */}
            <div className="space-y-2.5 pt-1 border-t border-line">
              <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5 text-brand-600" /> Color Themes
                </span>
              </label>

              {/* Banner Background Color */}
              <div>
                <span className="text-[10px] font-medium text-muted block mb-1">
                  Banner Background Color
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    { name: "Ivory Cream", val: "#faf6ee" },
                    { name: "Champagne", val: "#f6f0df" },
                    { name: "White", val: "#ffffff" },
                    { name: "Deep Maroon", val: "#4a141b" },
                    { name: "Midnight", val: "#0b0f19" },
                    { name: "Transparent", val: "transparent" },
                  ].map((b) => (
                    <button
                      key={b.val}
                      type="button"
                      onClick={() => setBgColor(b.val)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-medium border transition-all cursor-pointer flex items-center gap-1 ${
                        bgColor === b.val
                          ? "border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500 font-bold"
                          : "border-line bg-surface text-ink hover:border-brand-300"
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full border border-black/10 shrink-0"
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
                  <label className="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-line bg-surface text-[10px] text-ink cursor-pointer hover:border-brand-300">
                    <input
                      type="color"
                      value={bgColor.startsWith("#") ? bgColor : "#faf6ee"}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="h-3 w-3 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    <span>Custom</span>
                  </label>
                </div>
              </div>

              {/* Text & Accent Color */}
              <div>
                <span className="text-[10px] font-medium text-muted block mb-1">
                  Text & Accent Color
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    { name: "Wine Burgundy", val: "#581c25" },
                    { name: "Warm Gold", val: "#c49b66" },
                    { name: "Royal Gold", val: "#eab308" },
                    { name: "Matte Charcoal", val: "#1a1a1a" },
                    { name: "Pure White", val: "#ffffff" },
                  ].map((c) => (
                    <button
                      key={c.val}
                      type="button"
                      onClick={() => setTextColor(c.val)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-medium border transition-all cursor-pointer flex items-center gap-1 ${
                        textColor === c.val
                          ? "border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500 font-bold"
                          : "border-line bg-surface text-ink hover:border-brand-300"
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full border border-black/10 shrink-0"
                        style={{ background: c.val }}
                      />
                      <span>{c.name}</span>
                    </button>
                  ))}
                  {/* Custom color input */}
                  <label className="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-line bg-surface text-[10px] text-ink cursor-pointer hover:border-brand-300">
                    <input
                      type="color"
                      value={textColor.startsWith("#") ? textColor : "#581c25"}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="h-3 w-3 cursor-pointer rounded border-0 bg-transparent p-0"
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const defaultTpl = EVENT_TEMPLATES.find((t) => t.id === "wed-straight-flat") || EVENT_TEMPLATES[0];
              handleSelectTemplate(defaultTpl);
            }}
            icon={<RotateCcw className="h-3.5 w-3.5" />}
          >
            Reset Defaults
          </Button>

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
