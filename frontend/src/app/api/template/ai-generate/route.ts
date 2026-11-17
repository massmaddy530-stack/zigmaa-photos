import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "")
  .trim()
  .replace(/^["']|["']$/g, "");

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "")
  .trim()
  .replace(/^["']|["']$/g, "");

const GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
];

const SYSTEM_INSTRUCTION = `
You are a world-class luxury CGI and vector artist specializing in photorealistic, high-end 3D event watermark overlays for Zigmaa Moments.
The user wants a REALISTIC, stunning visual masterpiece matching this prompt: e.g. "background bubble template", "flower template with roses", "celebration balloons", "royal crest", "classic arched banner", etc.

CRITICAL VISUAL REALISM REQUIREMENTS:
1. DO NOT draw flat, cartoon doodle shapes. Everything must look 3D, realistic, luminous, and rich.
2. For BUBBLES:
   - Create multi-stop 3D radial gradients with realistic glass refraction (transparent center, luminous neon rim, specular white crescent glare at top-left, and soft ambient bounce light).
   - Draw multiple overlapping bubbles in varying depths (large foreground with blur, crisp middle-ground, small background bokeh).
   - Add specular highlight reflections: tiny white curved paths or offset circles inside each bubble (e.g. fill="white" opacity="0.85").
3. For FLOWERS / ROSES:
   - Draw layered blooming petals with rich gradients (e.g. burgundy to crimson to soft rose), botanical leaves with gold veins, and ornate filigree flourishes.
4. For STARS / SPARKLES:
   - Use multi-point 3D diamond star flares with Gaussian blur glow filters and intense white center cores.
5. Canvas specs: viewBox="0 0 1200 320" width="1200" height="320" xmlns="http://www.w3.org/2000/svg".
6. Central typography with EXACT IDs:
   - <text id="svg-subtitle" x="600" y="160" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="18" font-weight="700" letter-spacing="6" fill="...">SUBTITLE</text>
   - <text id="svg-names" x="600" y="225" text-anchor="middle" font-family="'Playfair Display', serif" font-size="56" font-style="italic" font-weight="700" fill="...">COUPLE OR PERSON NAMES</text>
   - <text id="svg-date" x="600" y="270" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="16" letter-spacing="4" fill="...">DATE / VENUE</text>
7. Background: Include a <rect id="svg-bg" width="1200" height="320" rx="16" ... /> with an appropriate fill.
8. Return ONLY valid JSON matching this schema:
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

    let parsedResult: Record<string, unknown> | null = null;
    let engineSource = "procedural_fallback";
    let lastError = "";

    // 1. Try OpenAI GPT-4o if API key is provided
    if (OPENAI_API_KEY) {
      try {
        const openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              { role: "system", content: SYSTEM_INSTRUCTION },
              { role: "user", content: `USER PROMPT: "${userPrompt}"\n\nReturn JSON:` },
            ],
            response_format: { type: "json_object" },
            temperature: 0.5,
            max_tokens: 4000,
          }),
        });

        const openAiData = await openAiRes.json();
        const content = openAiData?.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content.trim());
          if (parsed && typeof parsed.svg === "string" && parsed.svg.includes("<svg")) {
            parsedResult = parsed;
            engineSource = "openai";
          }
        } else if (openAiData?.error) {
          lastError = `OpenAI: ${openAiData.error.message || String(openAiData.error.code)}`;
        }
      } catch (err: unknown) {
        lastError = `OpenAI error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // 2. Try Gemini if OpenAI was not used or failed
    if (!parsedResult && GEMINI_API_KEY) {
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
                temperature: 0.5,
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
                engineSource = "gemini";
                break;
              }
            } catch {
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
                    bgColor: "#090d16",
                    svg: svgMatch[0],
                  };
                  engineSource = "gemini";
                  break;
                }
              }
            }
          } else if (data?.error) {
            lastError = `Gemini: ${data.error.message || String(data.error)}`;
          }
        } catch (err: unknown) {
          lastError = `Gemini error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    // 3. Fallback to Ultra-Realistic Procedural 3D SVG Engine if API is busy/quota exhausted
    if (!parsedResult || typeof parsedResult.svg !== "string") {
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
        source: engineSource,
        note: lastError ? `AI notice: ${lastError}` : undefined,
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
      themeName: typeof parsedResult.themeName === "string" ? parsedResult.themeName : "Realistic 3D Artwork",
      names: finalNames,
      subtitle: finalSubtitle,
      dateText: finalDate,
      venueText: typeof parsedResult.venueText === "string" ? parsedResult.venueText : "",
      fontFamily: typeof parsedResult.fontFamily === "string" ? parsedResult.fontFamily : "Playfair Display",
      textColor: typeof parsedResult.textColor === "string" ? parsedResult.textColor : "#ffffff",
      bgColor: typeof parsedResult.bgColor === "string" ? parsedResult.bgColor : "#090d16",
      source: engineSource,
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
    // Ultra-Realistic 3D Iridescent Soap Bubbles with Specular Glares & Sparkles
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 320" width="1200" height="320">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#090d16" stop-opacity="0.95"/>
          <stop offset="50%" stop-color="#121829" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#1e102d" stop-opacity="0.95"/>
        </linearGradient>
        <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#f6d365"/>
          <stop offset="40%" stop-color="#fda085"/>
          <stop offset="70%" stop-color="#ffeaa7"/>
          <stop offset="100%" stop-color="#dfa53a"/>
        </linearGradient>
        <radialGradient id="bubblePink" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
          <stop offset="25%" stop-color="#fbcfe8" stop-opacity="0.45"/>
          <stop offset="60%" stop-color="#c084fc" stop-opacity="0.25"/>
          <stop offset="90%" stop-color="#ec4899" stop-opacity="0.65"/>
          <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.85"/>
        </radialGradient>
        <radialGradient id="bubbleCyan" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
          <stop offset="25%" stop-color="#bae6fd" stop-opacity="0.45"/>
          <stop offset="60%" stop-color="#38bdf8" stop-opacity="0.25"/>
          <stop offset="90%" stop-color="#0284c7" stop-opacity="0.65"/>
          <stop offset="100%" stop-color="#6366f1" stop-opacity="0.85"/>
        </radialGradient>
        <radialGradient id="bubbleGold" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
          <stop offset="25%" stop-color="#fef08a" stop-opacity="0.45"/>
          <stop offset="60%" stop-color="#fde047" stop-opacity="0.25"/>
          <stop offset="90%" stop-color="#eab308" stop-opacity="0.65"/>
          <stop offset="100%" stop-color="#f97316" stop-opacity="0.85"/>
        </radialGradient>
        <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
        <filter id="textShadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.7"/>
        </filter>
        <g id="realistic-bubble-pink">
          <circle cx="0" cy="0" r="45" fill="url(#bubblePink)"/>
          <circle cx="0" cy="0" r="44" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-opacity="0.7"/>
          <ellipse cx="-14" cy="-16" rx="14" ry="7" transform="rotate(-30 -14 -16)" fill="#ffffff" opacity="0.85"/>
          <ellipse cx="14" cy="18" rx="8" ry="3" transform="rotate(-30 14 18)" fill="#ffffff" opacity="0.45"/>
        </g>
        <g id="realistic-bubble-cyan">
          <circle cx="0" cy="0" r="40" fill="url(#bubbleCyan)"/>
          <circle cx="0" cy="0" r="39" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-opacity="0.7"/>
          <ellipse cx="-12" cy="-14" rx="12" ry="6" transform="rotate(-30 -12 -14)" fill="#ffffff" opacity="0.85"/>
          <ellipse cx="12" cy="16" rx="7" ry="2.5" transform="rotate(-30 12 16)" fill="#ffffff" opacity="0.45"/>
        </g>
        <g id="realistic-bubble-gold">
          <circle cx="0" cy="0" r="35" fill="url(#bubbleGold)"/>
          <circle cx="0" cy="0" r="34" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-opacity="0.7"/>
          <ellipse cx="-10" cy="-12" rx="10" ry="5" transform="rotate(-30 -10 -12)" fill="#ffffff" opacity="0.85"/>
          <ellipse cx="10" cy="14" rx="6" ry="2" transform="rotate(-30 10 14)" fill="#ffffff" opacity="0.45"/>
        </g>
        <g id="star-flare" filter="url(#softGlow)">
          <path d="M 0,-14 Q 0,0 14,0 Q 0,0 0,14 Q 0,0 -14,0 Q 0,0 0,-14 Z" fill="#fff9db"/>
          <circle cx="0" cy="0" r="3" fill="#ffffff"/>
        </g>
      </defs>
      <rect id="svg-bg" width="1200" height="320" rx="16" fill="url(#bgGrad)"/>
      <path d="M 60,285 Q 600,245 1140,285" fill="none" stroke="url(#goldGrad)" stroke-width="2" stroke-opacity="0.8"/>
      <path d="M 120,292 Q 600,258 1080,292" fill="none" stroke="url(#goldGrad)" stroke-width="1" stroke-opacity="0.4" stroke-dasharray="6,4"/>
      <use href="#realistic-bubble-pink" x="110" y="160" transform="scale(1.2)"/>
      <use href="#realistic-bubble-cyan" x="210" y="100" transform="scale(0.9)"/>
      <use href="#realistic-bubble-gold" x="70" y="240" transform="scale(0.8)"/>
      <use href="#realistic-bubble-pink" x="230" y="220" transform="scale(0.65)"/>
      <use href="#realistic-bubble-cyan" x="160" y="50" transform="scale(0.5)"/>
      <use href="#realistic-bubble-cyan" x="1080" y="150" transform="scale(1.25)"/>
      <use href="#realistic-bubble-pink" x="970" y="90" transform="scale(0.95)"/>
      <use href="#realistic-bubble-gold" x="1130" y="230" transform="scale(0.85)"/>
      <use href="#realistic-bubble-cyan" x="960" y="210" transform="scale(0.7)"/>
      <use href="#realistic-bubble-pink" x="1030" y="45" transform="scale(0.55)"/>
      <use href="#star-flare" x="280" y="80"/>
      <use href="#star-flare" x="320" y="220" transform="scale(0.7)"/>
      <use href="#star-flare" x="880" y="70"/>
      <use href="#star-flare" x="910" y="230" transform="scale(0.7)"/>
      <use href="#star-flare" x="600" y="45" transform="scale(0.9)"/>
      <circle cx="340" cy="150" r="3" fill="#ffeaa7"/>
      <circle cx="380" cy="180" r="2" fill="#fd79a8"/>
      <circle cx="820" cy="170" r="3" fill="#74b9ff"/>
      <circle cx="850" cy="130" r="2" fill="#ffeaa7"/>
      <g filter="url(#textShadow)">
        <text id="svg-subtitle" x="600" y="145" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="18" font-weight="700" letter-spacing="8" fill="url(#goldGrad)">${subtitle}</text>
        <text id="svg-names" x="600" y="215" text-anchor="middle" font-family="'Playfair Display', serif" font-size="64" font-style="italic" font-weight="700" fill="#ffffff">${names}</text>
        <text id="svg-date" x="600" y="260" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="15" font-weight="600" letter-spacing="6" fill="#bae6fd">${dateText}</text>
      </g>
    </svg>`;

    return {
      themeName: "3D Iridescent Bubbles Celebration",
      names,
      subtitle,
      dateText,
      venueText: "",
      fontFamily: "Playfair Display",
      textColor: "#ffffff",
      bgColor: "#090d16",
      svg,
    };
  }

  if (p.includes("flower") || p.includes("rose") || p.includes("floral")) {
    // Ultra-Realistic Layered Rose Floral & Gold Foil Filigree
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 320" width="1200" height="320">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#2a080d"/>
          <stop offset="50%" stop-color="#150406"/>
          <stop offset="100%" stop-color="#0a0103"/>
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
        <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <g id="master-rose">
          <circle cx="0" cy="0" r="26" fill="url(#roseGrad)"/>
          <circle cx="0" cy="0" r="18" fill="#e05362" opacity="0.6"/>
          <circle cx="0" cy="0" r="10" fill="#ffd700" opacity="0.4"/>
          <path d="M -15,-8 Q 0,-22 15,-8 Q 24,10 0,22 Q -24,10 -15,-8 Z" fill="none" stroke="#f7e8c4" stroke-width="1.5" opacity="0.9"/>
          <path d="M -10,-4 Q 0,-14 10,-4 Q 15,6 0,14 Q -15,6 -10,-4 Z" fill="none" stroke="#ffd700" stroke-width="1.2" opacity="0.8"/>
        </g>
      </defs>
      <rect id="svg-bg" width="1200" height="320" rx="16" fill="url(#bgGrad)"/>
      <rect x="20" y="20" width="1160" height="280" rx="12" fill="none" stroke="url(#goldGrad)" stroke-width="1.5" stroke-opacity="0.7"/>
      <rect x="28" y="28" width="1144" height="264" rx="8" fill="none" stroke="url(#goldGrad)" stroke-width="0.8" stroke-opacity="0.4"/>
      <!-- Left Floral Bouquet -->
      <g transform="translate(130, 160)">
        <use href="#master-rose" transform="translate(-40, 20) scale(1.3)"/>
        <use href="#master-rose" transform="translate(10, -20) scale(1.1)"/>
        <use href="#master-rose" transform="translate(45, 30) scale(0.85)"/>
        <path d="M -80,50 Q -30,0 20,-40" fill="none" stroke="#5d8a66" stroke-width="2.5"/>
        <path d="M -60,60 Q -10,30 50,50" fill="none" stroke="#5d8a66" stroke-width="2"/>
        <path d="M -90,70 Q 0,80 80,0" fill="none" stroke="url(#goldGrad)" stroke-width="1.5" filter="url(#goldGlow)"/>
      </g>
      <!-- Right Floral Bouquet (Mirrored) -->
      <g transform="translate(1070, 160) scale(-1, 1)">
        <use href="#master-rose" transform="translate(-40, 20) scale(1.3)"/>
        <use href="#master-rose" transform="translate(10, -20) scale(1.1)"/>
        <use href="#master-rose" transform="translate(45, 30) scale(0.85)"/>
        <path d="M -80,50 Q -30,0 20,-40" fill="none" stroke="#5d8a66" stroke-width="2.5"/>
        <path d="M -60,60 Q -10,30 50,50" fill="none" stroke="#5d8a66" stroke-width="2"/>
        <path d="M -90,70 Q 0,80 80,0" fill="none" stroke="url(#goldGrad)" stroke-width="1.5" filter="url(#goldGlow)"/>
      </g>
      <!-- Central Typography -->
      <g filter="url(#goldGlow)">
        <text id="svg-subtitle" x="600" y="135" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="16" font-weight="700" letter-spacing="8" fill="url(#goldGrad)">${subtitle}</text>
        <text id="svg-names" x="600" y="210" text-anchor="middle" font-family="'Playfair Display', serif" font-size="64" font-style="italic" font-weight="700" fill="#ffffff">${names}</text>
        <text id="svg-date" x="600" y="260" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="15" font-weight="600" letter-spacing="6" fill="#f7e8c4">${dateText}</text>
      </g>
    </svg>`;

    return {
      themeName: "Luxury Rose Garden Wedding",
      names,
      subtitle,
      dateText,
      venueText: "",
      fontFamily: "Playfair Display",
      textColor: "#ffffff",
      bgColor: "#2a080d",
      svg,
    };
  }

  // Default: Clean Straight Flat Ivory Banner
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 260" width="1200" height="260">
    <defs>
      <linearGradient id="ivoryGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#faf6ee"/>
        <stop offset="100%" stop-color="#f5efe1"/>
      </linearGradient>
    </defs>
    <!-- Straight flat banner card with gold accent lines -->
    <rect id="svg-bg" x="0" y="0" width="1200" height="260" fill="url(#ivoryGrad)"/>
    <line x1="0" y1="2" x2="1200" y2="2" stroke="#c49b66" stroke-width="2" stroke-opacity="0.8"/>
    <line x1="0" y1="6" x2="1200" y2="6" stroke="#c49b66" stroke-width="1" stroke-opacity="0.4"/>
    <!-- Central Typography -->
    <text id="svg-subtitle" x="600" y="65" text-anchor="middle" font-family="'Cinzel', Georgia, serif" font-size="18" font-weight="600" letter-spacing="6" fill="#581c25">${subtitle}</text>
    <text id="svg-names" x="600" y="145" text-anchor="middle" font-family="'Playfair Display', serif" font-size="72" font-style="italic" font-weight="700" fill="#581c25">${names}</text>
    <g transform="translate(600, 195)">
      <line x1="-240" y1="-5" x2="-100" y2="-5" stroke="#c49b66" stroke-width="1" stroke-opacity="0.5"/>
      <text id="svg-date" x="0" y="0" text-anchor="middle" font-family="'Montserrat', sans-serif" font-size="16" letter-spacing="4" fill="#581c25">${dateText}</text>
      <line x1="100" y1="-5" x2="240" y2="-5" stroke="#c49b66" stroke-width="1" stroke-opacity="0.5"/>
    </g>
  </svg>`;

  return {
    themeName: "Straight Flat Ivory Banner",
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
