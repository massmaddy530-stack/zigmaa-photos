"use client";

import { ArrowDownUp, ArrowLeftRight, MoveDiagonal2, RotateCw } from "lucide-react";
import { useRef } from "react";

export interface WatermarkOverlayBoxProps {
  src: string;
  alt: string;
  isEditing: boolean;
  isDragging?: boolean;
  xPercent: number;
  yPercent: number;
  sizePercent: number;
  heightPercent?: number;
  rotation?: number;
  opacity: number;
  filterCss?: string;
  previewRef: React.RefObject<HTMLDivElement | null>;
  onSelect?: () => void;
  onStartDrag: (e: React.PointerEvent) => void;
  onTransformChange: (patch: { sizePercent?: number; heightPercent?: number; rotation?: number }) => void;
  title?: string;
}

function normalizeAngle(deg: number): number {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (Math.abs(a) <= 3) a = 0;
  return Math.round(a);
}

/**
 * Renders a watermark/template overlay on the cover preview with interactive
 * drag-to-move, width/height/corner arrow resize handles, and top rotate handle.
 */
export function WatermarkOverlayBox({
  src,
  alt,
  isEditing,
  isDragging = false,
  xPercent,
  yPercent,
  sizePercent,
  heightPercent,
  rotation = 0,
  opacity,
  filterCss,
  previewRef,
  onSelect,
  onStartDrag,
  onTransformChange,
  title,
}: WatermarkOverlayBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const safeOpacity = opacity > 1 ? opacity / 100 : opacity;
  const hasExplicitHeight = typeof heightPercent === "number" && heightPercent > 0;

  const startResize = (mode: "width" | "height" | "corner") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const container = previewRef.current;
    const box = boxRef.current;
    if (!container || !box) return;

    const cRect = container.getBoundingClientRect();
    const bRect = box.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = sizePercent;
    const startH = hasExplicitHeight
      ? heightPercent!
      : Math.max(5, Math.min(100, Math.round((bRect.height / cRect.height) * 100)));

    const onMove = (ev: PointerEvent) => {
      const dxPct = ((ev.clientX - startX) / cRect.width) * 100;
      const dyPct = ((ev.clientY - startY) / cRect.height) * 100;

      if (mode === "width") {
        const nextW = Math.max(5, Math.min(100, Math.round(startW + dxPct)));
        onTransformChange({ sizePercent: nextW });
      } else if (mode === "height") {
        const nextH = Math.max(5, Math.min(100, Math.round(startH + dyPct)));
        onTransformChange({ heightPercent: nextH });
      } else {
        const delta = Math.abs(dxPct) >= Math.abs(dyPct) ? dxPct : dyPct;
        const nextW = Math.max(5, Math.min(100, Math.round(startW + delta)));
        if (hasExplicitHeight) {
          const ratio = startH / Math.max(1, startW);
          const nextH = Math.max(5, Math.min(100, Math.round(nextW * ratio)));
          onTransformChange({ sizePercent: nextW, heightPercent: nextH });
        } else {
          onTransformChange({ sizePercent: nextW });
        }
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const box = boxRef.current;
    if (!box) return;

    const bRect = box.getBoundingClientRect();
    const cx = bRect.left + bRect.width / 2;
    const cy = bRect.top + bRect.height / 2;

    const onMove = (ev: PointerEvent) => {
      const angle = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
      onTransformChange({ rotation: normalizeAngle(angle) });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={boxRef}
      onPointerDown={onStartDrag}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
      style={{
        position: "absolute",
        left: `${xPercent}%`,
        top: `${yPercent}%`,
        transform: `translate(-${xPercent}%, -${yPercent}%) rotate(${rotation}deg)`,
        transformOrigin: "center center",
        width: `${sizePercent}%`,
        height: hasExplicitHeight ? `${heightPercent}%` : undefined,
        cursor: isDragging ? "grabbing" : "grab",
        touchAction: "none",
        userSelect: "none",
      }}
      className={`transition-opacity duration-150 select-none ${
        isEditing ? "ring-2 ring-brand-500 rounded shadow-md" : ""
      }`}
      title={title}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          width: "100%",
          height: hasExplicitHeight ? "100%" : "auto",
          objectFit: hasExplicitHeight ? "fill" : undefined,
          display: "block",
          opacity: safeOpacity,
          filter: filterCss,
          pointerEvents: "none",
        }}
      />

      {isEditing && (
        <>
          {/* Top Rotate Handle */}
          <div
            onPointerDown={startRotate}
            onClick={(e) => e.stopPropagation()}
            title={`Drag to rotate (${rotation}°)`}
            className="absolute -top-8 left-1/2 -translate-x-1/2 flex flex-col items-center cursor-grab active:cursor-grabbing z-20"
            style={{ opacity: 1 }}
          >
            <div className="flex items-center justify-center h-5 w-5 rounded-full bg-brand-600 text-white shadow-md border border-white hover:scale-110 transition-transform">
              <RotateCw className="h-3 w-3" />
            </div>
            <div className="w-px h-3 bg-brand-500" />
          </div>

          {/* Right Edge Width Handle */}
          <div
            onPointerDown={startResize("width")}
            onClick={(e) => e.stopPropagation()}
            title="Drag left/right to adjust width"
            className="absolute top-1/2 -right-2.5 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-full bg-white text-brand-600 border border-brand-500 shadow-md cursor-ew-resize hover:scale-110 transition-transform z-20"
          >
            <ArrowLeftRight className="h-3 w-3" />
          </div>

          {/* Bottom Edge Height Handle */}
          <div
            onPointerDown={startResize("height")}
            onClick={(e) => e.stopPropagation()}
            title="Drag up/down to adjust height"
            className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 flex items-center justify-center h-5 w-5 rounded-full bg-white text-brand-600 border border-brand-500 shadow-md cursor-ns-resize hover:scale-110 transition-transform z-20"
          >
            <ArrowDownUp className="h-3 w-3" />
          </div>

          {/* Bottom-Right Corner Proportional Scale Handle */}
          <div
            onPointerDown={startResize("corner")}
            onClick={(e) => e.stopPropagation()}
            title="Drag corner to resize"
            className="absolute -bottom-2.5 -right-2.5 flex items-center justify-center h-5 w-5 rounded-full bg-brand-600 text-white border border-white shadow-md cursor-nwse-resize hover:scale-110 transition-transform z-20"
          >
            <MoveDiagonal2 className="h-3 w-3" />
          </div>
        </>
      )}
    </div>
  );
}
