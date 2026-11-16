import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() || "";

const GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-flash-latest",
];

const SYSTEM_INSTRUCTION = `
You are an expert event watermark and luxury graphic designer for Zigmaa Photos.
Your job is to analyze the user's prompt (event type, couple names, date, venue, colors, style, mood) and generate a complete, perfectly tuned JSON configuration for a watermark banner or monogram.

Choose the best matching preset:
- "classic-arched-banner": Flat luxury background card with top upward curved arch (e.g. wedding banners, traditional ceremonies, South Indian, royal weddings)
- "minimalist-straight-banner": Clean horizontal bottom bar with gold accent line (e.g. modern receptions, cocktail parties)
- "royal-crest": Monogram initials inside luxury heraldic shield (e.g. luxury royal monograms, initials branding)
- "botanical-wreath": Delicate laurel branch circular wreath (e.g. engagements, garden weddings)
- "transparent-signature": Transparent luxury calligraphy script watermark without background card (e.g. photography signatures, subtle overlays)

Return ONLY valid JSON with no markdown backticks, matching this exact schema:
{
  "preset": "classic-arched-banner" | "minimalist-straight-banner" | "royal-crest" | "botanical-wreath" | "transparent-signature",
  "subtitle": string (e.g. "THE WEDDING OF", "ENGAGEMENT CEREMONY OF", "RECEPTION OF", "CELEBRATING", "SAVE THE DATE"),
  "names": string (e.g. "Arun & Keerthana", "Naveen & Sneha"),
  "dateText": string (e.g. "14 FEBRUARY 2026"),
  "venueText": string (e.g. "The Grand Palace, Chennai"),
  "fontFamily": "Playfair Display" | "Cormorant Garamond" | "Cinzel" | "Great Vibes" | "Alex Brush" | "Montserrat",
  "isItalic": boolean,
  "namesFontSize": number (between 50 and 110, default 82),
  "subtitleFontSize": number (between 14 and 26, default 20),
  "dateFontSize": number (between 14 and 24, default 18),
  "letterSpacing": number (between 2 and 10, default 5),
  "arcHeight": number (between 0 and 55, default 45),
  "bgColor": string (hex color like "#faf6ee" for ivory, "#f6f0df" for champagne, "#ffffff" for white, "#4a141b" for maroon, "#141416" for midnight, or "transparent"),
  "textColor": string (hex color like "#581c25" for wine, "#dfb15b" for gold, "#c49b66" for rose gold, "#1a1a1a" for dark, or "#ffffff" for white),
  "borderColor": string (hex color like "#c49b66" or "#dfb15b"),
  "showBorder": boolean,
  "showCalendarIcon": boolean,
  "showDividers": boolean,
  "showVenue": boolean
}
`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userPrompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

    if (!userPrompt) {
      return NextResponse.json(
        { ok: false, error: "Please enter a prompt to generate a template." },
        { status: 400 }
      );
    }

    if (!GEMINI_API_KEY) {
      const fallbackConfig = buildSmartFallback(userPrompt);
      return NextResponse.json({
        ok: true,
        template: fallbackConfig,
        source: "fallback",
        note: "GEMINI_API_KEY is not set in environment. Used smart template designer.",
      });
    }

    let rawOutput = "";
    let lastError = "";

    // Try models in fallback order
    for (const model of GEMINI_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `${SYSTEM_INSTRUCTION}\n\nUSER PROMPT: "${userPrompt}"\n\nReturn JSON:`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 800,
            },
          }),
        });

        const data = await res.json();
        const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText) {
          rawOutput = candidateText;
          break;
        } else if (data?.error) {
          lastError = data.error.message || String(data.error);
        }
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (!rawOutput) {
      // Fallback rule-based parsing if Gemini API is temporarily busy
      const fallbackConfig = buildSmartFallback(userPrompt);
      return NextResponse.json({
        ok: true,
        template: fallbackConfig,
        source: "fallback",
        note: lastError ? `AI model busy (${lastError}), used smart preset.` : undefined,
      });
    }

    // Clean JSON (strip markdown codeblocks if model included them)
    const cleaned = rawOutput
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsedConfig;
    try {
      parsedConfig = JSON.parse(cleaned);
    } catch {
      // If JSON parse fails, fallback
      parsedConfig = buildSmartFallback(userPrompt);
    }

    // Sanitize and ensure safe defaults
    const template = sanitizeConfig(parsedConfig);

    return NextResponse.json({
      ok: true,
      template,
      source: "gemini",
    });
  } catch (error: unknown) {
    console.error("AI template generation error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to generate template. Please try again." },
      { status: 500 }
    );
  }
}

function buildSmartFallback(prompt: string) {
  const p = prompt.toLowerCase();
  const isRoyal = p.includes("royal") || p.includes("crest") || p.includes("monogram");
  const isMaroon = p.includes("maroon") || p.includes("wine") || p.includes("red");
  const isDark = p.includes("dark") || p.includes("black") || p.includes("midnight");
  const isWreath = p.includes("wreath") || p.includes("botanical") || p.includes("leaf");
  const isTransparent = p.includes("transparent") || p.includes("signature");

  let detectedNames = "Arun & Keerthana";
  if (prompt.includes("&")) {
    detectedNames = prompt.split(/wedding|reception|engagement|in\s|on\s|at\s/i)[0].trim();
  }

  return {
    preset: isRoyal
      ? "royal-crest"
      : isWreath
      ? "botanical-wreath"
      : isTransparent
      ? "transparent-signature"
      : "classic-arched-banner",
    subtitle: p.includes("engagement")
      ? "ENGAGEMENT CEREMONY OF"
      : p.includes("reception")
      ? "WEDDING RECEPTION OF"
      : "THE WEDDING OF",
    names: detectedNames || "Arun & Keerthana",
    dateText: "14 FEBRUARY 2026",
    venueText: "Chennai, Tamil Nadu",
    fontFamily: isRoyal ? "Cinzel" : isWreath ? "Cormorant Garamond" : "Playfair Display",
    isItalic: true,
    namesFontSize: 85,
    subtitleFontSize: 20,
    dateFontSize: 18,
    letterSpacing: 5,
    arcHeight: 45,
    bgColor: isDark ? "#141416" : isMaroon ? "#4a141b" : isTransparent ? "transparent" : "#faf6ee",
    textColor: isDark || isMaroon ? "#dfb15b" : "#581c25",
    borderColor: "#c49b66",
    showBorder: true,
    showCalendarIcon: true,
    showDividers: true,
    showVenue: p.includes("chennai") || p.includes("palace") || p.includes("hall"),
  };
}

function sanitizeConfig(config: Record<string, unknown>) {
  const validPresets = [
    "classic-arched-banner",
    "minimalist-straight-banner",
    "royal-crest",
    "botanical-wreath",
    "transparent-signature",
  ];
  const validFonts = [
    "Playfair Display",
    "Cormorant Garamond",
    "Cinzel",
    "Great Vibes",
    "Alex Brush",
    "Montserrat",
  ];

  const preset = validPresets.includes(String(config.preset))
    ? String(config.preset)
    : "classic-arched-banner";

  const fontFamily = validFonts.includes(String(config.fontFamily))
    ? String(config.fontFamily)
    : "Playfair Display";

  return {
    preset,
    subtitle: typeof config.subtitle === "string" && config.subtitle.trim() ? config.subtitle.trim() : "THE WEDDING OF",
    names: typeof config.names === "string" && config.names.trim() ? config.names.trim() : "Arun & Keerthana",
    dateText: typeof config.dateText === "string" && config.dateText.trim() ? config.dateText.trim() : "14 FEBRUARY 2026",
    venueText: typeof config.venueText === "string" ? config.venueText.trim() : "Chennai, India",
    fontFamily,
    isItalic: typeof config.isItalic === "boolean" ? config.isItalic : true,
    namesFontSize: typeof config.namesFontSize === "number" ? Math.max(45, Math.min(130, config.namesFontSize)) : 82,
    subtitleFontSize: typeof config.subtitleFontSize === "number" ? Math.max(12, Math.min(36, config.subtitleFontSize)) : 20,
    dateFontSize: typeof config.dateFontSize === "number" ? Math.max(12, Math.min(32, config.dateFontSize)) : 18,
    letterSpacing: typeof config.letterSpacing === "number" ? Math.max(0, Math.min(14, config.letterSpacing)) : 5,
    arcHeight: typeof config.arcHeight === "number" ? Math.max(0, Math.min(65, config.arcHeight)) : 45,
    bgColor: typeof config.bgColor === "string" ? config.bgColor : "#faf6ee",
    textColor: typeof config.textColor === "string" ? config.textColor : "#581c25",
    borderColor: typeof config.borderColor === "string" ? config.borderColor : "#c49b66",
    showBorder: typeof config.showBorder === "boolean" ? config.showBorder : true,
    showCalendarIcon: typeof config.showCalendarIcon === "boolean" ? config.showCalendarIcon : true,
    showDividers: typeof config.showDividers === "boolean" ? config.showDividers : true,
    showVenue: typeof config.showVenue === "boolean" ? config.showVenue : false,
  };
}
