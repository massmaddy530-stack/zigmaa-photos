import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "")
  .trim()
  .replace(/^["']|["']$/g, "");

const GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
];

const SYSTEM_INSTRUCTION = `
You are an elite vector SVG artist and luxury event graphic designer for Zigmaa Photos.
Your job is to analyze the user's prompt (e.g. "background bubble template", "flower template with roses", "celebration balloons", "royal crest", "vintage gold", birthday, wedding, reception, etc.) and generate:
1. Dynamic, theme-specific visual artwork rendered in pure, self-contained SVG.
2. The artwork MUST match the user's creative theme:
   - If prompt mentions "bubble": draw translucent floating bubbles with specular reflections (<radialGradient>), glowing spheres, and cheerful pastel highlights.
   - If prompt mentions "flower" / "floral" / "roses" / "botanical": draw blooming petals, roses, leaf branches, delicate vine borders, and floral bouquets on left and right.
   - If prompt mentions "balloon" / "party" / "birthday": draw 3D-shaded party balloons with strings, confetti bits, sparkles, ribbons.
   - If prompt mentions "royal" / "luxury" / "crest": draw heraldic monogram crest, ornate baroque flourishes, gold filigree frames.
   - If prompt asks for a flat classic banner: draw an elegant upward arched banner or straight bar with gold borders.
   - Any other random creative theme: creatively illustrate visual vector shapes representing that concept!
3. The SVG canvas must have viewBox="0 0 1200 320" width="1200" height="320" xmlns="http://www.w3.org/2000/svg".
4. Background: Include a <rect id="svg-bg" width="1200" height="320" ... /> with an appropriate fill (deep midnight, wine maroon, ivory cream, or translucent gradient).
5. Central typography with EXACT IDs:
   - <text id="svg-subtitle" x="600" y="160" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="18" font-weight="600" letter-spacing="6" fill="...">SUBTITLE</text>
   - <text id="svg-names" x="600" y="225" text-anchor="middle" font-family="'Playfair Display', serif" font-size="56" font-style="italic" font-weight="700" fill="...">COUPLE OR PERSON NAMES</text>
   - <text id="svg-date" x="600" y="270" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="16" letter-spacing="4" fill="...">DATE / VENUE</text>
6. Keep the SVG valid, self-contained, and clean (< 4000 chars) without external image links.
7. Return ONLY valid JSON matching this schema:
{
  "themeName": string,
  "names": string,
  "subtitle": string,
  "dateText": string,
  "venueText": string,
  "fontFamily": "Playfair Display" | "Cormorant Garamond" | "Cinzel" | "Great Vibes" | "Alex Brush" | "Montserrat",
  "textColor": string,
  "bgColor": string,
  "svg": string
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
      const fallback = buildDynamicSvgFallback(userPrompt);
      return NextResponse.json({
        ok: true,
        isCustomSvg: true,
        svg: fallback.svg,
        themeName: fallback.themeName,
        names: fallback.names,
        subtitle: fallback.subtitle,
        dateText: fallback.dateText,
        venueText: fallback.venueText,
        fontFamily: fallback.fontFamily,
        textColor: fallback.textColor,
        bgColor: fallback.bgColor,
        source: "fallback",
        note: "GEMINI_API_KEY not configured. Used smart procedural designer.",
      });
    }

    let parsedResult: Record<string, unknown> | null = null;
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
              maxOutputTokens: 4500,
              responseMimeType: "application/json",
            },
          }),
        });

        const data = await res.json();
        const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText) {
          try {
            const parsed = JSON.parse(candidateText.trim());
            if (parsed && typeof parsed.svg === "string" && parsed.svg.includes("<svg")) {
              parsedResult = parsed;
              break;
            }
          } catch {
            // Check if candidateText is raw SVG
            if (candidateText.includes("<svg") && candidateText.includes("</svg>")) {
              const svgMatch = candidateText.match(/<svg[\s\S]*?<\/svg>/i);
              if (svgMatch) {
                parsedResult = {
                  themeName: "AI Artwork",
                  names: extractNames(userPrompt),
                  subtitle: extractSubtitle(userPrompt),
                  dateText: extractDate(userPrompt),
                  fontFamily: "Playfair Display",
                  textColor: "#ffffff",
                  bgColor: "#141416",
                  svg: svgMatch[0],
                };
                break;
              }
            }
          }
        } else if (data?.error) {
          lastError = data.error.message || String(data.error);
        }
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (!parsedResult || typeof parsedResult.svg !== "string") {
      // Fallback rule-based procedural generation if Gemini API is temporarily busy
      const fallback = buildDynamicSvgFallback(userPrompt);
      return NextResponse.json({
        ok: true,
        isCustomSvg: true,
        svg: fallback.svg,
        themeName: fallback.themeName,
        names: fallback.names,
        subtitle: fallback.subtitle,
        dateText: fallback.dateText,
        venueText: fallback.venueText,
        fontFamily: fallback.fontFamily,
        textColor: fallback.textColor,
        bgColor: fallback.bgColor,
        source: "procedural_fallback",
        note: lastError ? `AI model busy (${lastError}), generated procedural theme.` : undefined,
      });
    }

    const cleanedSvg = String(parsedResult.svg).trim();
    const finalNames = typeof parsedResult.names === "string" && parsedResult.names.trim()
      ? parsedResult.names.trim()
      : extractNames(userPrompt);
    const finalSubtitle = typeof parsedResult.subtitle === "string" && parsedResult.subtitle.trim()
      ? parsedResult.subtitle.trim()
      : extractSubtitle(userPrompt);
    const finalDate = typeof parsedResult.dateText === "string" && parsedResult.dateText.trim()
      ? parsedResult.dateText.trim()
      : extractDate(userPrompt);

    return NextResponse.json({
      ok: true,
      isCustomSvg: true,
      svg: cleanedSvg,
      themeName: typeof parsedResult.themeName === "string" ? parsedResult.themeName : "AI Custom Artwork",
      names: finalNames,
      subtitle: finalSubtitle,
      dateText: finalDate,
      venueText: typeof parsedResult.venueText === "string" ? parsedResult.venueText : "",
      fontFamily: typeof parsedResult.fontFamily === "string" ? parsedResult.fontFamily : "Playfair Display",
      textColor: typeof parsedResult.textColor === "string" ? parsedResult.textColor : "#ffffff",
      bgColor: typeof parsedResult.bgColor === "string" ? parsedResult.bgColor : "#1f0408",
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

function extractNames(prompt: string): string {
  const p = prompt.trim();
  const forMatch = p.match(/for\s+([A-Za-z0-9\s&]+?)(?=\s+(?:on|in|at|\d{1,2}[-/.]|\d{4}|$))/i);
  if (forMatch && forMatch[1].trim()) {
    return forMatch[1].trim().replace(/birthday|wedding|reception|function|ceremony/gi, "").trim();
  }
  if (p.includes("&")) {
    const parts = p.split(/&/);
    const name1 = parts[0].trim().split(/\s+/).pop() || "Arun";
    const name2 = parts[1].trim().split(/\s+/)[0] || "Keerthana";
    return `${name1} & ${name2}`;
  }
  return "Rithvik";
}

function extractSubtitle(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("birthday")) return "HAPPY BIRTHDAY";
  if (p.includes("engagement")) return "ENGAGEMENT CEREMONY OF";
  if (p.includes("reception")) return "WEDDING RECEPTION OF";
  if (p.includes("anniversary")) return "CELEBRATING ANNIVERSARY";
  return "THE WEDDING OF";
}

function extractDate(prompt: string): string {
  const dateMatch = prompt.match(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]+\s+\d{4}\b/i);
  if (dateMatch) return dateMatch[0].toUpperCase();
  return "17 NOVEMBER 2026";
}

function buildDynamicSvgFallback(prompt: string) {
  const p = prompt.toLowerCase();
  const names = extractNames(prompt);
  const subtitle = extractSubtitle(prompt);
  const dateText = extractDate(prompt);

  if (p.includes("bubble")) {
    // High-quality pastel bubble theme
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 320" width="1200" height="320">
      <defs>
        <linearGradient id="bg-grad" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#0b1329" stop-opacity="0.95"/>
          <stop offset="100%" stop-color="#1c284e" stop-opacity="0.8"/>
        </linearGradient>
        <radialGradient id="bubble-grad" cx="30%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.7"/>
          <stop offset="40%" stop-color="#8be9fd" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#ff79c6" stop-opacity="0.15"/>
        </radialGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
      </defs>
      <rect id="svg-bg" width="1200" height="320" fill="url(#bg-grad)"/>
      <g fill="none" stroke="url(#bubble-grad)" stroke-width="1.5">
        <circle cx="120" cy="160" r="45" fill="url(#bubble-grad)"/>
        <circle cx="240" cy="80" r="25" fill="url(#bubble-grad)"/>
        <circle cx="900" cy="100" r="60" fill="url(#bubble-grad)"/>
        <circle cx="1050" cy="200" r="35" fill="url(#bubble-grad)"/>
        <circle cx="180" cy="260" r="30" fill="url(#bubble-grad)"/>
        <circle cx="1000" cy="270" r="20" fill="url(#bubble-grad)"/>
        <circle cx="600" cy="50" r="15" fill="url(#bubble-grad)"/>
      </g>
      <path d="M 100 290 Q 600 240 1100 290" fill="none" stroke="#ffd700" stroke-width="1.5" stroke-opacity="0.6"/>
      <text id="svg-subtitle" x="600" y="160" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="18" font-weight="600" letter-spacing="6" fill="#ffd700" filter="url(#glow)">${subtitle}</text>
      <text id="svg-names" x="600" y="225" text-anchor="middle" font-family="'Playfair Display', serif" font-size="56" font-style="italic" font-weight="700" fill="#ffffff" filter="url(#glow)">${names}</text>
      <text id="svg-date" x="600" y="270" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="16" letter-spacing="4" fill="#8be9fd">${dateText}</text>
    </svg>`;

    return {
      themeName: "Pastel Bubbles Celebration",
      names,
      subtitle,
      dateText,
      venueText: "",
      fontFamily: "Playfair Display",
      textColor: "#ffffff",
      bgColor: "#0b1329",
      svg,
    };
  }

  if (p.includes("flower") || p.includes("rose") || p.includes("floral")) {
    // Rich rose floral banner
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 320" width="1200" height="320">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1f0408"/>
          <stop offset="50%" stop-color="#120204"/>
          <stop offset="100%" stop-color="#1f0408"/>
        </linearGradient>
        <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#dfbc7e"/>
          <stop offset="50%" stop-color="#f7e8c4"/>
          <stop offset="100%" stop-color="#c49b66"/>
        </linearGradient>
        <linearGradient id="roseGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#d46a84"/>
          <stop offset="50%" stop-color="#9c3d54"/>
          <stop offset="100%" stop-color="#591d2c"/>
        </linearGradient>
      </defs>
      <rect id="svg-bg" width="1200" height="320" fill="url(#bgGrad)" opacity="0.95"/>
      <rect x="20" y="20" width="1160" height="280" fill="none" stroke="url(#goldGrad)" stroke-width="1.5" stroke-opacity="0.6"/>
      <rect x="28" y="28" width="1144" height="264" fill="none" stroke="url(#goldGrad)" stroke-width="0.5" stroke-opacity="0.3"/>
      <g id="roses-left" transform="translate(120, 100)">
        <path d="M-40,40 Q-20,0 0,40 T40,40" fill="none" stroke="#a38054" stroke-width="1.5"/>
        <circle cx="0" cy="0" r="22" fill="url(#roseGrad)"/>
        <circle cx="35" cy="25" r="15" fill="url(#roseGrad)"/>
        <path d="M-50,20 Q-30,10 -20,-10" fill="none" stroke="#769960" stroke-width="2"/>
        <path d="M-30,40 Q-10,30 10,20" fill="none" stroke="#769960" stroke-width="2"/>
      </g>
      <g id="roses-right" transform="translate(1080, 100) scale(-1, 1)">
        <path d="M-40,40 Q-20,0 0,40 T40,40" fill="none" stroke="#a38054" stroke-width="1.5"/>
        <circle cx="0" cy="0" r="22" fill="url(#roseGrad)"/>
        <circle cx="35" cy="25" r="15" fill="url(#roseGrad)"/>
        <path d="M-50,20 Q-30,10 -20,-10" fill="none" stroke="#769960" stroke-width="2"/>
        <path d="M-30,40 Q-10,30 10,20" fill="none" stroke="#769960" stroke-width="2"/>
      </g>
      <g id="filigree" fill="none" stroke="url(#goldGrad)" stroke-width="1">
        <path d="M200,60 C400,30 800,30 1000,60"/>
        <path d="M200,260 C400,290 800,290 1000,260"/>
        <circle cx="600" cy="45" r="3" fill="url(#goldGrad)"/></g>
      <text id="svg-subtitle" x="600" y="135" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="16" font-weight="600" letter-spacing="8" fill="#dfbc7e">${subtitle}</text>
      <text id="svg-names" x="600" y="205" text-anchor="middle" font-family="'Playfair Display', serif" font-size="64" font-style="italic" font-weight="700" fill="#ffffff">${names}</text>
      <text id="svg-date" x="600" y="255" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="14" font-weight="500" letter-spacing="6" fill="#dfbc7e">${dateText}</text>
    </svg>`;

    return {
      themeName: "Rose Floral Elegance",
      names,
      subtitle,
      dateText,
      venueText: "",
      fontFamily: "Playfair Display",
      textColor: "#ffffff",
      bgColor: "#1f0408",
      svg,
    };
  }

  // Default Classic Ivory Flat Arched Banner
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 280" width="1200" height="280">
    <defs>
      <linearGradient id="ivoryBg" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#faf6ee" />
        <stop offset="100%" stop-color="#f5efe1" />
      </linearGradient>
    </defs>
    <path id="svg-bg" d="M 0,45 Q 600,0 1200,45 L 1200,280 L 0,280 Z" fill="url(#ivoryBg)" stroke="#c49b66" stroke-width="2"/>
    <path d="M 12,54 Q 600,12 1188,54" fill="none" stroke="#c49b66" stroke-width="1" stroke-opacity="0.6"/>
    <text id="svg-subtitle" x="600" y="110" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="18" font-weight="600" letter-spacing="6" fill="#581c25">${subtitle}</text>
    <text id="svg-names" x="600" y="185" text-anchor="middle" font-family="'Playfair Display', serif" font-size="78" font-style="italic" font-weight="700" fill="#581c25">${names}</text>
    <text id="svg-date" x="600" y="235" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="16" letter-spacing="4" fill="#581c25">${dateText}</text>
  </svg>`;

  return {
    themeName: "Classic Ivory Arched Banner",
    names,
    subtitle,
    dateText,
    venueText: "",
    fontFamily: "Playfair Display",
    textColor: "#581c25",
    bgColor: "#faf6ee",
    svg,
  };
}
