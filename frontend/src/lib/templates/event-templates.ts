// Event watermark templates catalog: 8 categories x 10 templates each = 80 templates
export interface EventCategory {
  id: string;
  label: string;
  emoji: string;
  description: string;
}

export interface TemplateRenderParams {
  names: string;
  subtitle: string;
  dateText: string;
  venueText?: string;
  fontFamily: string;
  isItalic: boolean;
  namesFontSize: number;
  subtitleFontSize: number;
  dateFontSize: number;
  textColor: string;
  bgColor: string;
}

export interface EventTemplateItem {
  id: string;
  categoryId: string;
  name: string;
  tagline: string;
  defaultSubtitle: string;
  defaultNames: string;
  defaultDate: string;
  defaultVenue?: string;
  defaultBgColor: string;
  defaultTextColor: string;
  defaultFontFamily: string;
  isItalic?: boolean;
  getSvg: (params: TemplateRenderParams) => string;
}

export const EVENT_CATEGORIES: EventCategory[] = [
  { id: "birthday", label: "Birthday", emoji: "🎂", description: "Balloons, bubbles, confetti & playful celebrations" },
  { id: "wedding", label: "Wedding", emoji: "💍", description: "Traditional South Indian, royal arches & luxury florals" },
  { id: "reception", label: "Reception", emoji: "🥂", description: "Chandeliers, fairy lights, bokeh & modern black-tie" },
  { id: "school", label: "School Events", emoji: "🎓", description: "Annual day curtains, graduation cap & honors laurels" },
  { id: "college", label: "College Events", emoji: "🏛️", description: "Tech symposium circuits, cultural concerts & hackathons" },
  { id: "sports", label: "Sports Events", emoji: "🏆", description: "Cricket turf, football nets, championship medals & cups" },
  { id: "baby_family", label: "Baby & Family", emoji: "👶", description: "Seemantham bangles, baby cradle, Ayush Homam & milestones" },
  { id: "temple_cultural", label: "Temple & Cultural", emoji: "🛕", description: "Temple gopuram, Bharatanatyam salangai, diyas & bells" },
];


// Helper to wrap standard typography into any template
function renderTypography(params: TemplateRenderParams) {
  const subtitleY = 48;
  const namesY = 118;
  const dateY = 178;
  const fontStack = `'${params.fontFamily}', 'Playfair Display', Georgia, serif`;

  return `
    <text id="svg-subtitle" x="600" y="${subtitleY}" text-anchor="middle" fill="${params.textColor}" style="font-family: 'Cinzel', 'Playfair Display', Georgia, serif; font-size: ${params.subtitleFontSize}px; letter-spacing: 4px; font-weight: 600; opacity: 0.9;">
      ${params.subtitle.toUpperCase()}
    </text>
    <text id="svg-names" x="600" y="${namesY}" text-anchor="middle" dominant-baseline="central" fill="${params.textColor}" style="font-family: ${fontStack}; font-size: ${params.namesFontSize}px; font-style: ${params.isItalic ? 'italic' : 'normal'}; font-weight: ${params.isItalic ? 500 : 600};">
      ${params.names}
    </text>
    <g fill="${params.textColor}">
      <line x1="380" y1="${dateY - 5}" x2="475" y2="${dateY - 5}" stroke="${params.textColor}" stroke-width="1" opacity="0.4" />
      <text id="svg-date" x="600" y="${dateY}" text-anchor="middle" fill="${params.textColor}" style="font-family: 'Cinzel', Georgia, serif; font-size: ${params.dateFontSize}px; letter-spacing: 3px; font-weight: 600;">
        ${params.dateText.toUpperCase()}
      </text>
      <line x1="725" y1="${dateY - 5}" x2="820" y2="${dateY - 5}" stroke="${params.textColor}" stroke-width="1" opacity="0.4" />
    </g>
    ${params.venueText ? `
      <text id="svg-venue" x="600" y="${dateY + 28}" text-anchor="middle" fill="${params.textColor}" style="font-family: 'Montserrat', sans-serif; font-size: 11px; letter-spacing: 2px; font-weight: 500; opacity: 0.75;">
        ${params.venueText.toUpperCase()}
      </text>
    ` : ''}
  `;
}

// Background rect helper
function renderBg(bgColor: string, height: number = 240, rx: number = 0) {
  if (bgColor === "transparent") return "";
  return `<rect id="svg-bg" x="0" y="0" width="1200" height="${height}" rx="${rx}" fill="${bgColor}" />`;
}

// Helper SVG Defs (Gradients & Filters)
const COMMON_DEFS = `
  <defs>
    <linearGradient id="goldLuxe" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f6d365" />
      <stop offset="50%" stop-color="#fda085" />
      <stop offset="100%" stop-color="#dfa53a" />
    </linearGradient>
    <linearGradient id="roseGold" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#fbcfe8" />
      <stop offset="50%" stop-color="#f43f5e" />
      <stop offset="100%" stop-color="#fb7185" />
    </linearGradient>
    <linearGradient id="cyanNeon" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00f2fe" />
      <stop offset="100%" stop-color="#4facfe" />
    </linearGradient>
    <linearGradient id="emeraldLuxe" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#059669" />
      <stop offset="100%" stop-color="#10b981" />
    </linearGradient>
    <radialGradient id="balloonGold" cx="35%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9" />
      <stop offset="30%" stop-color="#fde047" />
      <stop offset="80%" stop-color="#ca8a04" />
      <stop offset="100%" stop-color="#713f12" />
    </radialGradient>
    <radialGradient id="balloonOnyx" cx="35%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#64748b" stop-opacity="0.8" />
      <stop offset="50%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#020617" />
    </radialGradient>
    <radialGradient id="bubbleRad" cx="30%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9" />
      <stop offset="30%" stop-color="#a5f3fc" stop-opacity="0.5" />
      <stop offset="70%" stop-color="#c084fc" stop-opacity="0.3" />
      <stop offset="95%" stop-color="#f472b6" stop-opacity="0.7" />
      <stop offset="100%" stop-color="#38bdf8" />
    </radialGradient>
    <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur" />
      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
  </defs>
`;

// Helper builders for decorations
function svgBalloons(x: number, y: number, color1: string = "url(#balloonGold)", color2: string = "url(#balloonOnyx)") {
  return `
    <g transform="translate(${x}, ${y})">
      <path d="M 0,40 Q -10,70 5,100" stroke="#c49b66" stroke-width="1.2" fill="none" opacity="0.6"/>
      <path d="M 35,40 Q 45,70 25,100" stroke="#c49b66" stroke-width="1.2" fill="none" opacity="0.6"/>
      <!-- Balloon 1 -->
      <ellipse cx="0" cy="20" rx="28" ry="34" fill="${color1}"/>
      <polygon points="-4,54 4,54 0,59" fill="#ca8a04"/>
      <!-- Balloon 2 -->
      <ellipse cx="35" cy="15" rx="24" ry="30" fill="${color2}"/>
      <polygon points="31,45 39,45 35,50" fill="#334155"/>
      <!-- Shimmers -->
      <ellipse cx="-8" cy="8" rx="8" ry="4" transform="rotate(-30 -8 8)" fill="#ffffff" opacity="0.65"/>
      <ellipse cx="28" cy="6" rx="6" ry="3" transform="rotate(-30 28 6)" fill="#ffffff" opacity="0.6"/>
    </g>
  `;
}

function svgLaurel(x: number, y: number, scale: number = 1, flip: boolean = false) {
  const transform = `translate(${x}, ${y}) scale(${flip ? -scale : scale}, ${scale})`;
  return `
    <g transform="${transform}" stroke="#c49b66" fill="#c49b66">
      <path d="M 0,60 Q 30,30 20,-30" fill="none" stroke-width="2"/>
      <path d="M 8,42 Q 18,36 12,30 Q 6,36 8,42 Z"/>
      <path d="M 18,22 Q 28,16 22,10 Q 16,16 18,22 Z"/>
      <path d="M 22,2 Q 32,-4 26,-10 Q 20,-4 22,2 Z"/>
      <path d="M 20,-18 Q 30,-24 24,-30 Q 18,-24 20,-18 Z"/>
    </g>
  `;
}

function svgLotus(x: number, y: number, scale: number = 1) {
  return `
    <g transform="translate(${x}, ${y}) scale(${scale})">
      <!-- Outer petals -->
      <path d="M 0,0 C -30,-15 -40,-45 -25,-60 C -10,-45 0,-20 0,0 Z" fill="#ec4899" opacity="0.8"/>
      <path d="M 0,0 C 30,-15 40,-45 25,-60 C 10,-45 0,-20 0,0 Z" fill="#ec4899" opacity="0.8"/>
      <!-- Mid petals -->
      <path d="M 0,0 C -20,-20 -25,-55 -12,-70 C -5,-50 0,-20 0,0 Z" fill="#f472b6"/>
      <path d="M 0,0 C 20,-20 25,-55 12,-70 C 5,-50 0,-20 0,0 Z" fill="#f472b6"/>
      <!-- Center petal -->
      <path d="M 0,0 C -10,-25 -10,-65 0,-80 C 10,-65 10,-25 0,0 Z" fill="#fbcfe8"/>
      <!-- Golden core -->
      <circle cx="0" cy="-15" r="7" fill="#fbbf24"/>
    </g>
  `;
}

function svgVilakku(x: number, y: number, scale: number = 0.8) {
  return `
    <g transform="translate(${x}, ${y}) scale(${scale})" fill="#d97706" stroke="#b45309">
      <!-- Lamp base -->
      <ellipse cx="0" cy="80" rx="30" ry="8" fill="#ca8a04"/>
      <path d="M -6,80 L -4,40 L 4,40 L 6,80 Z" fill="#ca8a04"/>
      <!-- Central oil bowl -->
      <ellipse cx="0" cy="40" rx="26" ry="7" fill="#f59e0b"/>
      <!-- Upper bowl -->
      <path d="M -4,40 L -3,15 L 3,15 L 4,40 Z" fill="#ca8a04"/>
      <ellipse cx="0" cy="15" rx="34" ry="9" fill="#f59e0b"/>
      <!-- Pinnacle -->
      <path d="M -5,15 Q 0,-5 0,-15 Q 0,-5 5,15 Z" fill="#ca8a04"/>
      <!-- Golden Flame -->
      <path d="M 0,6 Q -10,-8 0,-28 Q 10,-8 0,6 Z" fill="url(#goldLuxe)" stroke="#f59e0b" stroke-width="1" filter="url(#softGlow)"/>
      <circle cx="0" cy="-6" r="3" fill="#ffffff"/>
    </g>
  `;
}

function svgStars(x: number, y: number) {
  return `
    <g transform="translate(${x}, ${y})" fill="#fbbf24">
      <path d="M 0,-10 Q 0,0 10,0 Q 0,0 0,10 Q 0,0 -10,0 Q 0,0 0,-10 Z"/>
      <path d="M 30,-5 Q 30,2 37,2 Q 30,2 30,9 Q 30,2 23,2 Q 30,2 30,-5 Z" transform="scale(0.7)"/>
      <path d="M -25,12 Q -25,18 -19,18 Q -25,18 -25,24 Q -25,18 -31,18 Q -25,18 -25,12 Z" transform="scale(0.6)"/>
    </g>
  `;
}

function svgTempleBell(x: number, y: number, scale: number = 0.9) {
  return `
    <g transform="translate(${x}, ${y}) scale(${scale})" fill="#d97706" stroke="#92400e">
      <!-- Hanging chain -->
      <line x1="0" y1="0" x2="0" y2="40" stroke="#b45309" stroke-width="3" stroke-dasharray="4,3"/>
      <!-- Bell crown ring -->
      <circle cx="0" cy="42" r="6" fill="none" stroke-width="3"/>
      <!-- Bell Body -->
      <path d="M -8,48 C -8,55 -24,75 -28,95 L 28,95 C 24,75 8,55 8,48 Z" fill="url(#goldLuxe)"/>
      <ellipse cx="0" cy="95" rx="28" ry="6" fill="#b45309"/>
      <!-- Clapper -->
      <circle cx="0" cy="103" r="5" fill="#78350f"/>
    </g>
  `;
}

function svgSportsCricket(x: number, y: number) {
  return `
    <g transform="translate(${x}, ${y})">
      <!-- Cricket Ball -->
      <circle cx="30" cy="40" r="16" fill="#dc2626" stroke="#991b1b" stroke-width="1.5"/>
      <path d="M 18,34 Q 30,40 42,46" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="2,2" fill="none"/>
      <!-- Cricket Bat Silhouette -->
      <g transform="rotate(-35 0 50)">
        <rect x="-8" y="0" width="16" height="50" rx="3" fill="#d97706" stroke="#b45309"/>
        <rect x="-3" y="-22" width="6" height="22" rx="2" fill="#fde68a" stroke="#ca8a04"/>
      </g>
    </g>
  `;
}

function svgGraduationCap(x: number, y: number) {
  return `
    <g transform="translate(${x}, ${y})">
      <!-- Cap top rhombus -->
      <polygon points="0,0 35,14 0,28 -35,14" fill="#0f172a" stroke="#ca8a04" stroke-width="1.5"/>
      <!-- Cap skull dome -->
      <path d="M -22,19 L -22,32 C -22,44 22,44 22,32 L 22,19" fill="#1e293b"/>
      <!-- Tassel button & cord -->
      <circle cx="0" cy="14" r="3" fill="#fbbf24"/>
      <path d="M 0,14 Q 24,20 28,38" fill="none" stroke="#fbbf24" stroke-width="1.5"/>
      <rect x="25" y="38" width="6" height="12" rx="2" fill="#ca8a04"/>
    </g>
  `;
}

// Full 80 templates catalog
export const EVENT_TEMPLATES: EventTemplateItem[] = [
  // --------------------------------------------------------------------------
  // 1. BIRTHDAY (10 Templates)
  // --------------------------------------------------------------------------
  {
    id: "bday-luxury-gold",
    categoryId: "birthday",
    name: "Luxury Gold & Onyx Balloons",
    tagline: "Glossy 3D gold & black floating balloons with gold dust",
    defaultSubtitle: "HAPPY 30TH BIRTHDAY",
    defaultNames: "Rithvik",
    defaultDate: "17 NOVEMBER 2026",
    defaultVenue: "The Leela Palace, Chennai",
    defaultBgColor: "#0b0f19",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Playfair Display",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240, 12)}
      <!-- Gold borders -->
      <line x1="0" y1="2" x2="1200" y2="2" stroke="#eab308" stroke-width="2" opacity="0.9"/>
      <line x1="0" y1="6" x2="1200" y2="6" stroke="#ca8a04" stroke-width="1" opacity="0.5"/>
      ${svgBalloons(120, 50, "url(#balloonGold)", "url(#balloonOnyx)")}
      ${svgBalloons(1020, 50, "url(#balloonOnyx)", "url(#balloonGold)")}
      ${svgStars(240, 70)}
      ${svgStars(930, 70)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "bday-iridescent-bubbles",
    categoryId: "birthday",
    name: "3D Iridescent Glow Bubbles",
    tagline: "Dreamy translucent soap bubbles with specular highlights",
    defaultSubtitle: "CELEBRATING 25 YEARS",
    defaultNames: "Ananya",
    defaultDate: "24 AUGUST 2026",
    defaultBgColor: "#090d16",
    defaultTextColor: "#ffffff",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240, 12)}
      <!-- Glowing bubbles left -->
      <g transform="translate(140, 110)">
        <circle cx="0" cy="0" r="38" fill="url(#bubbleRad)"/>
        <ellipse cx="-12" cy="-14" rx="12" ry="6" transform="rotate(-30 -12 -14)" fill="#ffffff" opacity="0.85"/>
        <circle cx="45" cy="20" r="22" fill="url(#bubbleRad)"/>
        <circle cx="-35" cy="25" r="16" fill="url(#bubbleRad)"/>
      </g>
      <!-- Glowing bubbles right -->
      <g transform="translate(1040, 110)">
        <circle cx="0" cy="0" r="38" fill="url(#bubbleRad)"/>
        <ellipse cx="-12" cy="-14" rx="12" ry="6" transform="rotate(-30 -12 -14)" fill="#ffffff" opacity="0.85"/>
        <circle cx="-45" cy="20" r="22" fill="url(#bubbleRad)"/>
        <circle cx="35" cy="25" r="16" fill="url(#bubbleRad)"/>
      </g>
      ${svgStars(250, 60)}
      ${svgStars(920, 60)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "bday-party-confetti",
    categoryId: "birthday",
    name: "Pastel Balloons & Confetti",
    tagline: "Cheerful celebration with falling party confetti & soft tones",
    defaultSubtitle: "HAPPY 1ST BIRTHDAY",
    defaultNames: "Aarav",
    defaultDate: "12 OCTOBER 2026",
    defaultBgColor: "#faf5ff",
    defaultTextColor: "#7e22ce",
    defaultFontFamily: "Dancing Script",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240, 12)}
      <g fill="#ec4899" opacity="0.7">
        <rect x="180" y="40" width="8" height="8" rx="2" transform="rotate(25 180 40)"/>
        <rect x="220" y="90" width="7" height="7" rx="2" fill="#3b82f6" transform="rotate(45 220 90)"/>
        <rect x="980" y="45" width="8" height="8" rx="2" fill="#eab308" transform="rotate(15 980 45)"/>
        <rect x="940" y="85" width="7" height="7" rx="2" fill="#10b981" transform="rotate(-30 940 85)"/>
      </g>
      ${svgBalloons(130, 45, "#f472b6", "#c084fc")}
      ${svgBalloons(1020, 45, "#60a5fa", "#34d399")}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "bday-safari-kids",
    categoryId: "birthday",
    name: "Cute 3D Safari Adventure",
    tagline: "Playful tropical jungle leaves and golden adventure frame",
    defaultSubtitle: "WILD ONE BIRTHDAY ADVENTURE",
    defaultNames: "Advik",
    defaultDate: "05 MAY 2026",
    defaultBgColor: "#fefce8",
    defaultTextColor: "#713f12",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240, 12)}
      <!-- Monstera leaves left -->
      <g transform="translate(130, 120) scale(0.9)" fill="#15803d">
        <path d="M 0,0 C -30,-40 -10,-80 30,-80 C 40,-40 20,-10 0,0 Z"/>
        <path d="M -15,-20 C -45,-30 -40,-60 -20,-70 Z" fill="#16a34a"/>
      </g>
      <!-- Monstera leaves right -->
      <g transform="translate(1030, 120) scale(-0.9, 0.9)" fill="#15803d">
        <path d="M 0,0 C -30,-40 -10,-80 30,-80 C 40,-40 20,-10 0,0 Z"/>
        <path d="M -15,-20 C -45,-30 -40,-60 -20,-70 Z" fill="#16a34a"/>
      </g>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "bday-princess-fairytale",
    categoryId: "birthday",
    name: "Royal Princess Fairytale",
    tagline: "Soft blush pink velvet with golden tiara & crystal starlight",
    defaultSubtitle: "SWEET SIXTEEN CELEBRATION",
    defaultNames: "Diya Sharma",
    defaultDate: "18 JUNE 2026",
    defaultBgColor: "#fdf2f8",
    defaultTextColor: "#9d174d",
    defaultFontFamily: "Great Vibes",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240, 12)}
      <!-- Tiara Crown Crest Top Center -->
      <g transform="translate(600, 20) scale(0.6)" fill="#f59e0b" stroke="#b45309">
        <path d="M -30,15 L -20,-10 L 0,8 L 20,-10 L 30,15 Z"/>
        <circle cx="-20" cy="-12" r="3" fill="#ec4899"/>
        <circle cx="0" cy="6" r="3" fill="#ec4899"/>
        <circle cx="20" cy="-12" r="3" fill="#ec4899"/>
      </g>
      ${svgStars(160, 80)}
      ${svgStars(1000, 80)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "bday-superhero-action",
    categoryId: "birthday",
    name: "Dynamic Superhero Comic",
    tagline: "Action starburst energy rays with bold comic highlights",
    defaultSubtitle: "HERO BIRTHDAY HEADQUARTERS",
    defaultNames: "Kabir",
    defaultDate: "09 JULY 2026",
    defaultBgColor: "#1e1b4b",
    defaultTextColor: "#facc15",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240, 12)}
      <g stroke="#f43f5e" stroke-width="2" opacity="0.6">
        <line x1="80" y1="40" x2="220" y2="90"/>
        <line x1="100" y1="180" x2="220" y2="130"/>
        <line x1="1120" y1="40" x2="980" y2="90"/>
        <line x1="1100" y1="180" x2="980" y2="130"/>
      </g>
      ${svgStars(150, 110)}
      ${svgStars(1010, 110)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "bday-neon-cyber",
    categoryId: "birthday",
    name: "Cyber Neon Glow Party",
    tagline: "Futuristic glowing neon corner brackets & club vibes",
    defaultSubtitle: "LEVEL 21 UNLOCKED",
    defaultNames: "Siddharth",
    defaultDate: "30 SEPTEMBER 2026",
    defaultBgColor: "#05050a",
    defaultTextColor: "#38bdf8",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240, 12)}
      <!-- Neon brackets left -->
      <path d="M 80,40 L 40,40 L 40,200 L 80,200" stroke="#00f2fe" stroke-width="3" fill="none" filter="url(#softGlow)"/>
      <!-- Neon brackets right -->
      <path d="M 1120,40 L 1160,40 L 1160,200 L 1120,200" stroke="#f43f5e" stroke-width="3" fill="none" filter="url(#softGlow)"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "bday-vintage-rose",
    categoryId: "birthday",
    name: "Vintage Rose Garden",
    tagline: "Romantic watercolor garden roses with cream linen card",
    defaultSubtitle: "CELEBRATING HER BIRTHDAY",
    defaultNames: "Meenakshi",
    defaultDate: "14 NOVEMBER 2026",
    defaultBgColor: "#faf6ee",
    defaultTextColor: "#831843",
    defaultFontFamily: "Parisienne",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240, 12)}
      <g transform="translate(140, 120)">
        <circle cx="0" cy="0" r="22" fill="#f43f5e" opacity="0.8"/>
        <circle cx="-10" cy="-6" r="14" fill="#fb7185"/>
        <path d="M -15,10 Q -30,25 -20,35 Q -5,25 -15,10 Z" fill="#15803d"/>
      </g>
      <g transform="translate(1040, 120)">
        <circle cx="0" cy="0" r="22" fill="#f43f5e" opacity="0.8"/>
        <circle cx="10" cy="-6" r="14" fill="#fb7185"/>
        <path d="M 15,10 Q 30,25 20,35 Q 5,25 15,10 Z" fill="#15803d"/>
      </g>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "bday-galaxy-cosmic",
    categoryId: "birthday",
    name: "Cosmic Galaxy & Starlight",
    tagline: "Deep space stardust with ringed planets and shooting flares",
    defaultSubtitle: "ACROSS THE UNIVERSE",
    defaultNames: "Neil Armstrong",
    defaultDate: "21 DECEMBER 2026",
    defaultBgColor: "#0f172a",
    defaultTextColor: "#e2e8f0",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240, 12)}
      <!-- Ringed planet left -->
      <g transform="translate(150, 110)">
        <circle cx="0" cy="0" r="20" fill="#6366f1"/>
        <ellipse cx="0" cy="0" rx="36" ry="8" transform="rotate(-20 0 0)" fill="none" stroke="#a5b4fc" stroke-width="2"/>
      </g>
      ${svgStars(1030, 110)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "bday-straight-minimal",
    categoryId: "birthday",
    name: "Modern Birthday Flat Bar",
    tagline: "Understated minimalist bottom bar with gold accent line",
    defaultSubtitle: "HAPPY BIRTHDAY CELEBRATION",
    defaultNames: "Varun",
    defaultDate: "03 MARCH 2026",
    defaultBgColor: "#ffffff",
    defaultTextColor: "#1e293b",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <line x1="0" y1="2" x2="1200" y2="2" stroke="#eab308" stroke-width="2" opacity="0.8"/>
      <line x1="0" y1="6" x2="1200" y2="6" stroke="#ca8a04" stroke-width="1" opacity="0.4"/>
      ${renderTypography(p)}
    </svg>`
  },

  // --------------------------------------------------------------------------
  // 2. WEDDING (10 Templates)
  // --------------------------------------------------------------------------
  {
    id: "wed-straight-flat",
    categoryId: "wedding",
    name: "Straight Flat Ivory Banner",
    tagline: "Flat warm cream bottom bar with dual gold lines (Image 2 match)",
    defaultSubtitle: "THE WEDDING OF",
    defaultNames: "Arun & Keerthana",
    defaultDate: "14 FEBRUARY 2026",
    defaultVenue: "The Grand Palace, Chennai",
    defaultBgColor: "#faf6ee",
    defaultTextColor: "#581c25",
    defaultFontFamily: "Playfair Display",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <line x1="0" y1="2" x2="1200" y2="2" stroke="#c49b66" stroke-width="2" opacity="0.8"/>
      <line x1="0" y1="6" x2="1200" y2="6" stroke="#c49b66" stroke-width="1" opacity="0.4"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "wed-south-tradition",
    categoryId: "wedding",
    name: "Traditional Jasmine & Kuthuvilakku",
    tagline: "Auspicious brass Vilakku with flame, jasmine strands & lotus",
    defaultSubtitle: "MANGALYA THARANAM",
    defaultNames: "Karthik & Sneha",
    defaultDate: "28 OCTOBER 2026",
    defaultBgColor: "#faf6ee",
    defaultTextColor: "#7f1d1d",
    defaultFontFamily: "Playfair Display",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <line x1="0" y1="2" x2="1200" y2="2" stroke="#d97706" stroke-width="2" opacity="0.9"/>
      ${svgVilakku(120, 70)}
      ${svgLotus(230, 160, 0.6)}
      ${svgVilakku(1060, 70)}
      ${svgLotus(950, 160, 0.6)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "wed-royal-arch",
    categoryId: "wedding",
    name: "Royal Rajputana Crimson & Gold",
    tagline: "Grand Rajasthani Mughal arch with 24k gold filigree",
    defaultSubtitle: "ROYAL WEDDING CELEBRATION",
    defaultNames: "Ranveer & Deepika",
    defaultDate: "15 NOVEMBER 2026",
    defaultBgColor: "#450a0a",
    defaultTextColor: "#fef08a",
    defaultFontFamily: "Cormorant Garamond",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- Mughal Arch border -->
      <path d="M 0,35 Q 300,10 600,3 Q 900,10 1200,35" stroke="#eab308" stroke-width="2" fill="none"/>
      ${svgLaurel(160, 120, 0.9)}
      ${svgLaurel(1020, 120, 0.9, true)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "wed-kasavu-zari",
    categoryId: "wedding",
    name: "Kerala Kasavu Gold Zari",
    tagline: "Authentic handloom Kasavu weave with gold zari borders",
    defaultSubtitle: "SUBHA MUHURTHAM",
    defaultNames: "Naveen & Anjali",
    defaultDate: "02 DECEMBER 2026",
    defaultBgColor: "#fefce8",
    defaultTextColor: "#854d0e",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- Kasavu Zari gold stripe band -->
      <rect x="0" y="0" width="1200" height="12" fill="#ca8a04"/>
      <rect x="0" y="228" width="1200" height="12" fill="#ca8a04"/>
      ${svgVilakku(140, 80, 0.7)}
      ${svgVilakku(1040, 80, 0.7)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "wed-christian-floral",
    categoryId: "wedding",
    name: "Christian White Rose Arch",
    tagline: "Cascading white English roses, orchids and pearl strings",
    defaultSubtitle: "HOLY MATRIMONY",
    defaultNames: "David & Rachel",
    defaultDate: "20 JANUARY 2026",
    defaultBgColor: "#ffffff",
    defaultTextColor: "#334155",
    defaultFontFamily: "Allura",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <g stroke="#cbd5e1" stroke-width="1">
        <line x1="0" y1="2" x2="1200" y2="2"/>
        <line x1="0" y1="238" x2="1200" y2="238"/>
      </g>
      ${svgLaurel(160, 110, 0.85)}
      ${svgLaurel(1020, 110, 0.85, true)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "wed-transparent-script",
    categoryId: "wedding",
    name: "Transparent Luxury Signature",
    tagline: "Overlay script without background box, perfect on photos",
    defaultSubtitle: "THE WEDDING OF",
    defaultNames: "Arun & Keerthana",
    defaultDate: "14 FEBRUARY 2026",
    defaultBgColor: "transparent",
    defaultTextColor: "#ffffff",
    defaultFontFamily: "Great Vibes",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "wed-botanical-wreath",
    categoryId: "wedding",
    name: "Handcrafted Botanical Wreath",
    tagline: "Delicate circular botanical laurel with golden leaves",
    defaultSubtitle: "TOGETHER WITH THEIR FAMILIES",
    defaultNames: "Vikram & Priya",
    defaultDate: "19 MARCH 2026",
    defaultBgColor: "#faf6ee",
    defaultTextColor: "#1e3a8a",
    defaultFontFamily: "Playfair Display",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <circle cx="150" cy="120" r="50" fill="none" stroke="#ca8a04" stroke-width="1.5" stroke-dasharray="4,3"/>
      <circle cx="1050" cy="120" r="50" fill="none" stroke="#ca8a04" stroke-width="1.5" stroke-dasharray="4,3"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "wed-temple-kovil",
    categoryId: "wedding",
    name: "South Indian Temple Heritage",
    tagline: "Dravidian temple Gopuram pinnacle & auspicious wedding bells",
    defaultSubtitle: "THIRUMANAM",
    defaultNames: "Suresh & Divya",
    defaultDate: "08 APRIL 2026",
    defaultBgColor: "#fafaf9",
    defaultTextColor: "#831843",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgTempleBell(150, 20, 0.8)}
      ${svgTempleBell(1030, 20, 0.8)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "wed-modern-eucalyptus",
    categoryId: "wedding",
    name: "Modern Eucalyptus & Gold Wire",
    tagline: "Geometric hexagonal fine wireframe with sage greenery",
    defaultSubtitle: "FOREVER & ALWAYS",
    defaultNames: "Aditya & Tara",
    defaultDate: "11 MAY 2026",
    defaultBgColor: "#ffffff",
    defaultTextColor: "#14532d",
    defaultFontFamily: "Bodoni Moda",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <polygon points="150,70 185,90 185,140 150,160 115,140 115,90" fill="none" stroke="#ca8a04" stroke-width="1.5"/>
      <polygon points="1050,70 1085,90 1085,140 1050,160 1015,140 1015,90" fill="none" stroke="#ca8a04" stroke-width="1.5"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "wed-regal-monogram",
    categoryId: "wedding",
    name: "Imperial Monogram Crest",
    tagline: "Royal heraldic shield emblem with luxury intertwined monogram",
    defaultSubtitle: "THE WEDDING CELEBRATION OF",
    defaultNames: "Raghav & Sunita",
    defaultDate: "27 NOVEMBER 2026",
    defaultBgColor: "#1e1b4b",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Cinzel Decorative",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <g stroke="#eab308" stroke-width="1.5" fill="none">
        <path d="M 150,60 L 190,90 L 190,140 Q 190,180 150,200 Q 110,180 110,140 L 110,90 Z"/>
        <path d="M 1050,60 L 1090,90 L 1090,140 Q 1090,180 1050,200 Q 1010,180 1010,140 L 1010,90 Z"/>
      </g>
      ${renderTypography(p)}
    </svg>`
  },

  // --------------------------------------------------------------------------
  // 3. RECEPTION (10 Templates)
  // --------------------------------------------------------------------------
  {
    id: "rec-crystal-chandelier",
    categoryId: "reception",
    name: "Grand Ballroom Chandelier",
    tagline: "Swarovski crystal chandelier silhouette with warm starlight glow",
    defaultSubtitle: "WEDDING RECEPTION",
    defaultNames: "Naveen & Meera",
    defaultDate: "24 DECEMBER 2026",
    defaultVenue: "ITC Grand Chola, Chennai",
    defaultBgColor: "#0f172a",
    defaultTextColor: "#fef08a",
    defaultFontFamily: "Playfair Display",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- Chandelier silhouette top left & right -->
      <g transform="translate(150, 10)" fill="#eab308" stroke="#ca8a04">
        <line x1="0" y1="0" x2="0" y2="40" stroke-width="2"/>
        <path d="M -30,45 Q 0,35 30,45 Q 20,60 0,70 Q -20,60 -30,45 Z" fill="url(#goldLuxe)"/>
      </g>
      <g transform="translate(1050, 10)" fill="#eab308" stroke="#ca8a04">
        <line x1="0" y1="0" x2="0" y2="40" stroke-width="2"/>
        <path d="M -30,45 Q 0,35 30,45 Q 20,60 0,70 Q -20,60 -30,45 Z" fill="url(#goldLuxe)"/>
      </g>
      ${svgStars(240, 80)}
      ${svgStars(940, 80)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "rec-midnight-velvet",
    categoryId: "reception",
    name: "Midnight Navy & Rose Gold",
    tagline: "Deep navy blue card with rose gold shimmer dust",
    defaultSubtitle: "COCKTAIL & RECEPTION EVENING",
    defaultNames: "Abhishek & Pooja",
    defaultDate: "10 JANUARY 2027",
    defaultBgColor: "#091026",
    defaultTextColor: "#fbcfe8",
    defaultFontFamily: "Pinyon Script",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <line x1="0" y1="2" x2="1200" y2="2" stroke="#f43f5e" stroke-width="2" opacity="0.8"/>
      ${svgStars(160, 90)}
      ${svgStars(1020, 90)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "rec-fairy-lights",
    categoryId: "reception",
    name: "Enchanted Garden Fairy Lights",
    tagline: "Warm strings of glowing fairy light bulbs and hanging ivy",
    defaultSubtitle: "DINNER & DANCING CELEBRATION",
    defaultNames: "Karan & Simran",
    defaultDate: "06 FEBRUARY 2027",
    defaultBgColor: "#172554",
    defaultTextColor: "#fef08a",
    defaultFontFamily: "Dancing Script",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- String lights hanging along top -->
      <path d="M 0,15 Q 300,45 600,20 Q 900,45 1200,15" stroke="#fef08a" stroke-width="1" fill="none" opacity="0.6"/>
      <g fill="#fde047" filter="url(#softGlow)">
        <circle cx="150" cy="28" r="4"/><circle cx="300" cy="36" r="4"/>
        <circle cx="450" cy="26" r="4"/><circle cx="750" cy="26" r="4"/>
        <circle cx="900" cy="36" r="4"/><circle cx="1050" cy="28" r="4"/>
      </g>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "rec-champagne-bokeh",
    categoryId: "reception",
    name: "Champagne Gold Bokeh",
    tagline: "Effervescent golden bokeh discs with celebratory bubbles",
    defaultSubtitle: "GRAND RECEPTION NIGHT",
    defaultNames: "Gautam & Shruti",
    defaultDate: "15 MARCH 2027",
    defaultBgColor: "#18181b",
    defaultTextColor: "#fef08a",
    defaultFontFamily: "Playfair Display",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <g fill="#eab308" opacity="0.25">
        <circle cx="120" cy="80" r="30"/><circle cx="180" cy="140" r="22"/>
        <circle cx="1020" cy="80" r="30"/><circle cx="1070" cy="140" r="22"/>
      </g>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "rec-floral-archway",
    categoryId: "reception",
    name: "Cascading Orchid Archway",
    tagline: "White hydrangeas and blushing orchids crowning top rim",
    defaultSubtitle: "AN EVENING OF LOVE & LAUGHTER",
    defaultNames: "Manish & Tanvi",
    defaultDate: "21 APRIL 2027",
    defaultBgColor: "#fafafa",
    defaultTextColor: "#475569",
    defaultFontFamily: "Cormorant Garamond",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgLaurel(150, 110, 0.8)}
      ${svgLaurel(1030, 110, 0.8, true)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "rec-black-tie",
    categoryId: "reception",
    name: "Ultra-Modern Black Tie",
    tagline: "Matte charcoal slate card with crisp gold pinstripe border",
    defaultSubtitle: "THE RECEPTION",
    defaultNames: "Prashanth & Ananya",
    defaultDate: "18 MAY 2027",
    defaultBgColor: "#171717",
    defaultTextColor: "#ffffff",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <rect x="10" y="10" width="1180" height="220" fill="none" stroke="#d4af37" stroke-width="1.2"/>
      <rect x="14" y="14" width="1172" height="212" fill="none" stroke="#d4af37" stroke-width="0.6" stroke-opacity="0.5"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "rec-starlight-glamour",
    categoryId: "reception",
    name: "Golden Starburst Glamour",
    tagline: "Explosive radial gold starburst rays and red carpet prestige",
    defaultSubtitle: "CELEBRATING THE NEWLYWEDS",
    defaultNames: "Rahul & Natasha",
    defaultDate: "05 JUNE 2027",
    defaultBgColor: "#020617",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Prata",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgStars(150, 110)}
      ${svgStars(1030, 110)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "rec-royal-emerald",
    categoryId: "reception",
    name: "Royal Emerald & Gold",
    tagline: "Deep emerald velvet with beveled gold filigree corner brackets",
    defaultSubtitle: "GRAND WEDDING RECEPTION",
    defaultNames: "Ajith & Shalini",
    defaultDate: "12 JULY 2027",
    defaultBgColor: "#064e3b",
    defaultTextColor: "#fef08a",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <path d="M 40,40 L 80,40 M 40,40 L 40,80" stroke="#fde047" stroke-width="2"/>
      <path d="M 1160,40 L 1120,40 M 1160,40 L 1160,80" stroke="#fde047" stroke-width="2"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "rec-flowing-ribbons",
    categoryId: "reception",
    name: "Graceful Silk Ribbon Streamers",
    tagline: "Flowing golden silk ribbons curving with dynamic elegance",
    defaultSubtitle: "AN EVENING TO REMEMBER",
    defaultNames: "Siddharth & Kiara",
    defaultDate: "29 AUGUST 2027",
    defaultBgColor: "#faf6ee",
    defaultTextColor: "#78350f",
    defaultFontFamily: "Alex Brush",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <path d="M 0,220 Q 300,180 600,220 Q 900,260 1200,220" stroke="#d97706" stroke-width="2" fill="none" opacity="0.6"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "rec-minimal-signature",
    categoryId: "reception",
    name: "Contemporary Signature",
    tagline: "Clean transparent overlay with fine twin gold separator lines",
    defaultSubtitle: "WEDDING RECEPTION",
    defaultNames: "Naveen & Meera",
    defaultDate: "24 DECEMBER 2026",
    defaultBgColor: "transparent",
    defaultTextColor: "#ffffff",
    defaultFontFamily: "Italianno",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderTypography(p)}
    </svg>`
  },

  // --------------------------------------------------------------------------
  // 4. SCHOOL EVENTS (10 Templates)
  // --------------------------------------------------------------------------
  {
    id: "sch-annual-day",
    categoryId: "school",
    name: "Annual Day Grand Curtains",
    tagline: "Royal blue parted stage curtains with golden spotlight beams",
    defaultSubtitle: "35TH ANNUAL DAY CELEBRATIONS",
    defaultNames: "St. Joseph's Higher Secondary School",
    defaultDate: "28 JANUARY 2027",
    defaultBgColor: "#1e3a8a",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- Parted curtains -->
      <path d="M 0,0 L 140,0 Q 80,120 0,240 Z" fill="#1e40af" opacity="0.8"/>
      <path d="M 1200,0 L 1060,0 Q 1120,120 1200,240 Z" fill="#1e40af" opacity="0.8"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "sch-graduation-cap",
    categoryId: "school",
    name: "Graduation Cap & Diploma",
    tagline: "3D mortarboard cap with golden tassel & parchment scroll",
    defaultSubtitle: "CONVOCATION CEREMONY",
    defaultNames: "Class of 2026",
    defaultDate: "15 APRIL 2026",
    defaultBgColor: "#0f172a",
    defaultTextColor: "#f1f5f9",
    defaultFontFamily: "Playfair Display",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgGraduationCap(150, 90)}
      ${svgGraduationCap(1030, 90)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "sch-kids-funfair",
    categoryId: "school",
    name: "Colorful Pencils & Buntings",
    tagline: "Cheerful party bunting flags & storybook accents",
    defaultSubtitle: "PRIMARY ANNUAL SPORTS & FUN FAIR",
    defaultNames: "Little Angels Academy",
    defaultDate: "10 NOVEMBER 2026",
    defaultBgColor: "#fef9c3",
    defaultTextColor: "#b45309",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- Bunting flags along top -->
      <polygon points="100,0 125,25 150,0" fill="#ef4444"/>
      <polygon points="150,0 175,25 200,0" fill="#3b82f6"/>
      <polygon points="1000,0 1025,25 1050,0" fill="#10b981"/>
      <polygon points="1050,0 1075,25 1100,0" fill="#f59e0b"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "sch-academic-honors",
    categoryId: "school",
    name: "Golden Laurel & Honors Star",
    tagline: "Twin golden laurel branches meeting at an academic star",
    defaultSubtitle: "ANNUAL AWARDS & HONORS DAY",
    defaultNames: "Excellence in Academics",
    defaultDate: "05 MARCH 2027",
    defaultBgColor: "#022c22",
    defaultTextColor: "#fef08a",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgLaurel(150, 110, 0.85)}
      ${svgLaurel(1030, 110, 0.85, true)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "sch-golden-quill",
    categoryId: "school",
    name: "Book & Golden Quill",
    tagline: "Classical book and glowing feather quill for literary heritage",
    defaultSubtitle: "INTER-SCHOOL LITERARY FESTIVAL",
    defaultNames: "Words & Wisdom 2026",
    defaultDate: "19 SEPTEMBER 2026",
    defaultBgColor: "#faf6ee",
    defaultTextColor: "#78350f",
    defaultFontFamily: "Cormorant Garamond",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <line x1="0" y1="2" x2="1200" y2="2" stroke="#b45309" stroke-width="2"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "sch-sports-meet",
    categoryId: "school",
    name: "School Sports Athletics",
    tagline: "Running track lanes at the base with winner's laurel",
    defaultSubtitle: "ANNUAL ATHLETIC MEET",
    defaultNames: "Champions in the Making",
    defaultDate: "12 DECEMBER 2026",
    defaultBgColor: "#14532d",
    defaultTextColor: "#ffffff",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- Red track curve at bottom -->
      <rect x="0" y="225" width="1200" height="15" fill="#dc2626"/>
      <line x1="0" y1="232" x2="1200" y2="232" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="12,12"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "sch-science-fair",
    categoryId: "school",
    name: "Science Discovery & STEM",
    tagline: "Glowing atomic electron orbits and innovation grid",
    defaultSubtitle: "REGIONAL SCIENCE & ROBOTICS EXPO",
    defaultNames: "Young Innovators 2026",
    defaultDate: "18 AUGUST 2026",
    defaultBgColor: "#0f172a",
    defaultTextColor: "#38bdf8",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- Atom orbit left -->
      <g transform="translate(150, 110)" stroke="#0284c7" stroke-width="1.5" fill="none">
        <circle cx="0" cy="0" r="6" fill="#38bdf8"/>
        <ellipse cx="0" cy="0" rx="30" ry="10" transform="rotate(30 0 0)"/>
        <ellipse cx="0" cy="0" rx="30" ry="10" transform="rotate(-30 0 0)"/>
      </g>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "sch-arts-drama",
    categoryId: "school",
    name: "Drama Masks & Symphony",
    tagline: "Classical gold comedy/tragedy masks with musical notes",
    defaultSubtitle: "INTER-SCHOOL DRAMA & MUSIC FEST",
    defaultNames: "Voices of Tomorrow",
    defaultDate: "27 OCTOBER 2026",
    defaultBgColor: "#3b0764",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgStars(150, 110)}
      ${svgStars(1030, 110)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "sch-alumni-crest",
    categoryId: "school",
    name: "Heritage School Emblem",
    tagline: "Classical collegiate shield frame with foundation motto",
    defaultSubtitle: "FOUNDER'S DAY CELEBRATIONS",
    defaultNames: "100 Years of Academic Excellence",
    defaultDate: "02 FEBRUARY 2027",
    defaultBgColor: "#450a0a",
    defaultTextColor: "#fef08a",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgLaurel(150, 110, 0.8)}
      ${svgLaurel(1030, 110, 0.8, true)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "sch-modern-straight",
    categoryId: "school",
    name: "Clean Scholastic Straight Banner",
    tagline: "Crisp navy blue horizontal bar with scholastic gold accents",
    defaultSubtitle: "GRADUATION DAY",
    defaultNames: "Greenwood International School",
    defaultDate: "30 MAY 2026",
    defaultBgColor: "#1e293b",
    defaultTextColor: "#ffffff",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <line x1="0" y1="2" x2="1200" y2="2" stroke="#38bdf8" stroke-width="2"/>
      ${renderTypography(p)}
    </svg>`
  },

  // --------------------------------------------------------------------------
  // 5. COLLEGE EVENTS (10 Templates)
  // --------------------------------------------------------------------------
  {
    id: "col-tech-symposium",
    categoryId: "college",
    name: "Cyber Matrix & Circuit Tracks",
    tagline: "Glowing cyan & electric purple circuit board tracks",
    defaultSubtitle: "NATIONAL LEVEL TECHNICAL SYMPOSIUM",
    defaultNames: "CYBERQUEST 2026",
    defaultDate: "14 SEPTEMBER 2026",
    defaultBgColor: "#030712",
    defaultTextColor: "#00f2fe",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- Circuit lines left -->
      <g stroke="#00f2fe" stroke-width="1.5" fill="none" opacity="0.7">
        <path d="M 60,60 L 140,60 L 180,100 L 220,100"/>
        <circle cx="220" cy="100" r="3" fill="#00f2fe"/>
        <path d="M 60,180 L 140,180 L 180,140 L 220,140"/>
        <circle cx="220" cy="140" r="3" fill="#00f2fe"/>
      </g>
      <!-- Circuit lines right -->
      <g stroke="#a855f7" stroke-width="1.5" fill="none" opacity="0.7">
        <path d="M 1140,60 L 1060,60 L 1020,100 L 980,100"/>
        <circle cx="980" cy="100" r="3" fill="#a855f7"/>
        <path d="M 1140,180 L 1060,180 L 1020,140 L 980,140"/>
        <circle cx="980" cy="140" r="3" fill="#a855f7"/>
      </g>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "col-cultural-fest",
    categoryId: "college",
    name: "Concert Stage & Laser Beams",
    tagline: "Stage floodlight beams and rock concert laser rays",
    defaultSubtitle: "ANNUAL INTER-COLLEGE CULTURAL FEST",
    defaultNames: "RHYTHM '26",
    defaultDate: "20 OCTOBER 2026",
    defaultBgColor: "#111827",
    defaultTextColor: "#f43f5e",
    defaultFontFamily: "Montserrat",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <line x1="80" y1="20" x2="220" y2="200" stroke="#f43f5e" stroke-width="2" opacity="0.6"/>
      <line x1="1120" y1="20" x2="980" y2="200" stroke="#06b6d4" stroke-width="2" opacity="0.6"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "col-hackathon-grid",
    categoryId: "college",
    name: "Holographic Hackathon Grid",
    tagline: "Developer code brackets < /> with futuristic cyber matrix",
    defaultSubtitle: "36-HOUR NATIONAL HACKATHON",
    defaultNames: "CODESTORM 2026",
    defaultDate: "07 NOVEMBER 2026",
    defaultBgColor: "#050811",
    defaultTextColor: "#10b981",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <text x="140" y="130" font-family="'Courier New', monospace" font-size="32" fill="#10b981" font-weight="bold">&lt; /&gt;</text>
      <text x="1030" y="130" font-family="'Courier New', monospace" font-size="32" fill="#10b981" font-weight="bold">&lt; /&gt;</text>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "col-farewell-nostalgia",
    categoryId: "college",
    name: "Vintage Farewell & Compass",
    tagline: "Warm mahogany woodgrain frame with nostalgic compass",
    defaultSubtitle: "FINAL YEAR FAREWELL CEREMONY",
    defaultNames: "Hasta La Vista 2026",
    defaultDate: "25 APRIL 2026",
    defaultBgColor: "#27170a",
    defaultTextColor: "#fef08a",
    defaultFontFamily: "Playfair Display",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <line x1="0" y1="2" x2="1200" y2="2" stroke="#ca8a04" stroke-width="2"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "col-cinematic-fest",
    categoryId: "college",
    name: "Film Reel & Golden Spotlight",
    tagline: "35mm movie film strip borders with cinema spotlights",
    defaultSubtitle: "SHORT FILM & MEDIA FESTIVAL",
    defaultNames: "LUMIERE '26",
    defaultDate: "11 DECEMBER 2026",
    defaultBgColor: "#09090b",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Bodoni Moda",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- Film perforations along top & bottom -->
      <g fill="#27272a">
        <rect x="100" y="4" width="12" height="8" rx="1"/><rect x="125" y="4" width="12" height="8" rx="1"/>
        <rect x="1050" y="4" width="12" height="8" rx="1"/><rect x="1075" y="4" width="12" height="8" rx="1"/>
      </g>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "col-esports-arena",
    categoryId: "college",
    name: "Neon Esports Gaming Shield",
    tagline: "Geometric gaming clan shield with aggressive neon styling",
    defaultSubtitle: "ALL INDIA ESPORTS CHAMPIONSHIP",
    defaultNames: "VALOR ARENA 2026",
    defaultDate: "18 JANUARY 2027",
    defaultBgColor: "#0a0a0f",
    defaultTextColor: "#ef4444",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <polygon points="140,80 180,100 180,150 140,170 100,150 100,100" fill="none" stroke="#ef4444" stroke-width="2"/>
      <polygon points="1060,80 1100,100 1100,150 1060,170 1020,150 1020,100" fill="none" stroke="#ef4444" stroke-width="2"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "col-management-conclave",
    categoryId: "college",
    name: "Corporate Leadership Conclave",
    tagline: "Professional steel blue & brushed silver beveled plaque",
    defaultSubtitle: "NATIONAL BUSINESS & LEADERSHIP SUMMIT",
    defaultNames: "VANGUARD 2026",
    defaultDate: "12 FEBRUARY 2027",
    defaultBgColor: "#1e293b",
    defaultTextColor: "#f8fafc",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <line x1="0" y1="2" x2="1200" y2="2" stroke="#94a3b8" stroke-width="2"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "col-fashion-walk",
    categoryId: "college",
    name: "Haute Couture Runway Glow",
    tagline: "Spotlights on minimalist black runway border with high fashion",
    defaultSubtitle: "ANNUAL FASHION DESIGN SHOWCASE",
    defaultNames: "GLAMOURA '26",
    defaultDate: "04 MARCH 2027",
    defaultBgColor: "#000000",
    defaultTextColor: "#ffffff",
    defaultFontFamily: "Playfair Display",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <line x1="100" y1="230" x2="1100" y2="230" stroke="#ffffff" stroke-width="1"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "col-convocation",
    categoryId: "college",
    name: "University Convocation Plaque",
    tagline: "Formal burgundy degree plaque with embossed golden seal",
    defaultSubtitle: "ANNUAL GRADUATION CONVOCATION",
    defaultNames: "Madras Institute of Technology",
    defaultDate: "20 JULY 2026",
    defaultBgColor: "#4c0519",
    defaultTextColor: "#fef08a",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgLaurel(150, 110, 0.85)}
      ${svgLaurel(1030, 110, 0.85, true)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "col-campus-beats",
    categoryId: "college",
    name: "Campus Beats & Audio Equalizer",
    tagline: "Pulsing DJ sound equalizer bars in sunset gradient",
    defaultSubtitle: "DJ NIGHT & MUSIC EXTRAVAGANZA",
    defaultNames: "ELECTRIFY 2026",
    defaultDate: "05 SEPTEMBER 2026",
    defaultBgColor: "#18181b",
    defaultTextColor: "#f43f5e",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- Equalizer bars left -->
      <g fill="#ec4899">
        <rect x="130" y="110" width="6" height="40" rx="2"/>
        <rect x="142" y="90" width="6" height="60" rx="2"/>
        <rect x="154" y="120" width="6" height="30" rx="2"/>
      </g>
      <!-- Equalizer bars right -->
      <g fill="#ec4899">
        <rect x="1040" y="120" width="6" height="30" rx="2"/>
        <rect x="1052" y="90" width="6" height="60" rx="2"/>
        <rect x="1064" y="110" width="6" height="40" rx="2"/>
      </g>
      ${renderTypography(p)}
    </svg>`
  },

  // --------------------------------------------------------------------------
  // 6. SPORTS EVENTS (10 Templates)
  // --------------------------------------------------------------------------
  {
    id: "spt-cricket-championship",
    categoryId: "sports",
    name: "Cricket Pitch & Stumps",
    tagline: "Green stadium turf with red leather ball & wooden stumps",
    defaultSubtitle: "PREMIER CRICKET LEAGUE",
    defaultNames: "CHAMPIONS TROPHY 2026",
    defaultDate: "15 MAY 2026",
    defaultBgColor: "#064e3b",
    defaultTextColor: "#facc15",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgSportsCricket(140, 80)}
      ${svgSportsCricket(1020, 80)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "spt-football-league",
    categoryId: "sports",
    name: "Soccer Goal Net & Field",
    tagline: "Realistic hexagonal soccer ball crashing into goal netting",
    defaultSubtitle: "STATE FOOTBALL TOURNAMENT",
    defaultNames: "SUPER LEAGUE 2026",
    defaultDate: "22 JUNE 2026",
    defaultBgColor: "#022c22",
    defaultTextColor: "#ffffff",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <circle cx="150" cy="120" r="24" fill="#ffffff" stroke="#000000" stroke-width="2"/>
      <circle cx="1050" cy="120" r="24" fill="#ffffff" stroke="#000000" stroke-width="2"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "spt-athletic-medals",
    categoryId: "sports",
    name: "Olympic Medals & Laurels",
    tagline: "Gold, silver & bronze medals with winner's laurel branches",
    defaultSubtitle: "STATE ATHLETIC CHAMPIONSHIPS",
    defaultNames: "GOLD MEDAL WINNERS",
    defaultDate: "18 JULY 2026",
    defaultBgColor: "#1e1b4b",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgLaurel(150, 110, 0.9)}
      ${svgLaurel(1030, 110, 0.9, true)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "spt-badminton-smash",
    categoryId: "sports",
    name: "Badminton Shuttlecock & Smash",
    tagline: "Aerodynamic feathered shuttlecock with supersonic gold streaks",
    defaultSubtitle: "OPEN BADMINTON CHAMPIONSHIP",
    defaultNames: "SMASH TOURNAMENT 2026",
    defaultDate: "09 AUGUST 2026",
    defaultBgColor: "#0c4a6e",
    defaultTextColor: "#38bdf8",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <line x1="0" y1="2" x2="1200" y2="2" stroke="#38bdf8" stroke-width="2"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "spt-basketball-court",
    categoryId: "sports",
    name: "Basketball Hoop & Flame",
    tagline: "Fiery basketball swooshing through net over hardwood floorboards",
    defaultSubtitle: "INTER-COLLEGIATE BASKETBALL",
    defaultNames: "SLAM DUNK 2026",
    defaultDate: "27 SEPTEMBER 2026",
    defaultBgColor: "#451a03",
    defaultTextColor: "#ea580c",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "spt-champion-trophy",
    categoryId: "sports",
    name: "Golden Victory Cup",
    tagline: "Gleaming golden victory trophy cup with falling gold foil confetti",
    defaultSubtitle: "GRAND FINALS CHAMPIONSHIP",
    defaultNames: "VICTORY TROPHY 2026",
    defaultDate: "14 OCTOBER 2026",
    defaultBgColor: "#020617",
    defaultTextColor: "#facc15",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgStars(150, 110)}
      ${svgStars(1030, 110)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "spt-marathon-finish",
    categoryId: "sports",
    name: "Marathon Finish Ribbon",
    tagline: "Crimson finish line ribbon with runner silhouette & road mark",
    defaultSubtitle: "ANNUAL CITY MARATHON",
    defaultNames: "RUN FOR GLORY 2026",
    defaultDate: "08 NOVEMBER 2026",
    defaultBgColor: "#dc2626",
    defaultTextColor: "#ffffff",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <line x1="0" y1="230" x2="1200" y2="230" stroke="#ffffff" stroke-width="4"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "spt-victory-flame",
    categoryId: "sports",
    name: "Eternal Victory Torch",
    tagline: "Olympic victory torch with blazing golden flame & olive wreath",
    defaultSubtitle: "NATIONAL GAMES CEREMONY",
    defaultNames: "HONOR & GLORY",
    defaultDate: "03 DECEMBER 2026",
    defaultBgColor: "#172554",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgLaurel(150, 110, 0.85)}
      ${svgLaurel(1030, 110, 0.85, true)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "spt-dynamic-speed",
    categoryId: "sports",
    name: "High-Speed Chevron Racing",
    tagline: "Dynamic angular racing chevrons in neon yellow & racing red",
    defaultSubtitle: "MOTORSPORTS & SPRINT RACES",
    defaultNames: "FAST TRACK 2026",
    defaultDate: "19 JANUARY 2027",
    defaultBgColor: "#09090b",
    defaultTextColor: "#facc15",
    defaultFontFamily: "Montserrat",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <polygon points="60,20 120,120 60,220 80,220 140,120 80,20" fill="#facc15"/>
      <polygon points="1140,20 1080,120 1140,220 1120,220 1060,120 1120,20" fill="#facc15"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "spt-sport-crest",
    categoryId: "sports",
    name: "Athletic Championship Shield",
    tagline: "Bold metallic athletic shield badge with sporty stars",
    defaultSubtitle: "ANNUAL SPORTS FESTIVAL",
    defaultNames: "GOLD CUP 2026",
    defaultDate: "28 FEBRUARY 2027",
    defaultBgColor: "#0284c7",
    defaultTextColor: "#ffffff",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${renderTypography(p)}
    </svg>`
  },

  // --------------------------------------------------------------------------
  // 7. BABY & FAMILY (10 Templates)
  // --------------------------------------------------------------------------
  {
    id: "fam-seemantham-valaikappu",
    categoryId: "baby_family",
    name: "Seemantham Valaikappu Bangles",
    tagline: "Auspicious green & red glass bangles with fragrant jasmine",
    defaultSubtitle: "VALAIKAPPU & SEEMANTHAM CEREMONY",
    defaultNames: "Sowmya & Vignesh",
    defaultDate: "16 AUGUST 2026",
    defaultBgColor: "#fef08a",
    defaultTextColor: "#7f1d1d",
    defaultFontFamily: "Playfair Display",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- Glass bangles stack left -->
      <g transform="translate(150, 110)">
        <ellipse cx="0" cy="-10" rx="30" ry="12" fill="none" stroke="#16a34a" stroke-width="4"/>
        <ellipse cx="0" cy="0" rx="30" ry="12" fill="none" stroke="#dc2626" stroke-width="4"/>
        <ellipse cx="0" cy="10" rx="30" ry="12" fill="none" stroke="#eab308" stroke-width="4"/>
      </g>
      <!-- Glass bangles stack right -->
      <g transform="translate(1050, 110)">
        <ellipse cx="0" cy="-10" rx="30" ry="12" fill="none" stroke="#16a34a" stroke-width="4"/>
        <ellipse cx="0" cy="0" rx="30" ry="12" fill="none" stroke="#dc2626" stroke-width="4"/>
        <ellipse cx="0" cy="10" rx="30" ry="12" fill="none" stroke="#eab308" stroke-width="4"/>
      </g>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "fam-baby-cradle",
    categoryId: "baby_family",
    name: "Sweet Wooden Baby Cradle",
    tagline: "Handcrafted baby cradle decorated with floral ribbons",
    defaultSubtitle: "CRADLE CEREMONY & NAMING",
    defaultNames: "Baby Ananya",
    defaultDate: "04 SEPTEMBER 2026",
    defaultBgColor: "#fdf2f8",
    defaultTextColor: "#be185d",
    defaultFontFamily: "Great Vibes",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgStars(150, 90)}
      ${svgStars(1030, 90)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "fam-ayush-homam",
    categoryId: "baby_family",
    name: "Ayush Homam Sacred Kalasham",
    tagline: "Holy Homa kunda brass vessel with gentle flame & coconut kalash",
    defaultSubtitle: "AYUSH HOMAM BLESSINGS",
    defaultNames: "Chi. Rithvik",
    defaultDate: "17 NOVEMBER 2026",
    defaultBgColor: "#fffbeb",
    defaultTextColor: "#92400e",
    defaultFontFamily: "Playfair Display",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgVilakku(140, 80, 0.75)}
      ${svgVilakku(1040, 80, 0.75)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "fam-sashtiapthapoorthi",
    categoryId: "baby_family",
    name: "60th Wedding Sashtiapthapoorthi",
    tagline: "Sacred twin brass Vilakku lamps & rich auspicious maroon silk",
    defaultSubtitle: "SASHTIAPTHAPOORTHI (60TH BIRTHDAY)",
    defaultNames: "Sri S. Ramanathan & Smt. Kalyani",
    defaultDate: "12 DECEMBER 2026",
    defaultBgColor: "#450a0a",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgVilakku(140, 70, 0.8)}
      ${svgVilakku(1040, 70, 0.8)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "fam-golden-jubilee",
    categoryId: "baby_family",
    name: "50th Golden Jubilee Anniversary",
    tagline: "Majestic 50th golden laurel wreath & champagne starlight",
    defaultSubtitle: "50 YEARS OF TOGETHERNESS",
    defaultNames: "Krishnan & Meenakshi",
    defaultDate: "28 JANUARY 2027",
    defaultBgColor: "#0f172a",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgLaurel(150, 110, 0.9)}
      ${svgLaurel(1030, 110, 0.9, true)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "fam-teddy-clouds",
    categoryId: "baby_family",
    name: "Fluffy Clouds & Hanging Stars",
    tagline: "Dreamy pastel clouds with golden crescent moon & stars",
    defaultSubtitle: "WELCOME TO THE WORLD",
    defaultNames: "Baby Kavin",
    defaultDate: "05 FEBRUARY 2027",
    defaultBgColor: "#eff6ff",
    defaultTextColor: "#1e40af",
    defaultFontFamily: "Montserrat",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgStars(150, 90)}
      ${svgStars(1030, 90)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "fam-naming-ceremony",
    categoryId: "baby_family",
    name: "Golden Lotus Naming Ceremony",
    tagline: "Blooming lotus on sacred ripples with pure divine blessings",
    defaultSubtitle: "NAMAKARANAM (NAMING CEREMONY)",
    defaultNames: "Chi. Sai Pranav",
    defaultDate: "18 MARCH 2027",
    defaultBgColor: "#faf5ff",
    defaultTextColor: "#6b21a8",
    defaultFontFamily: "Playfair Display",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgLotus(150, 150, 0.7)}
      ${svgLotus(1050, 150, 0.7)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "fam-grihapravesham",
    categoryId: "baby_family",
    name: "Housewarming Mango Thoranam",
    tagline: "Fresh green mango leaf thoranam & auspicious Kolam",
    defaultSubtitle: "GRIHAPRAVESHAM (HOUSEWARMING)",
    defaultNames: "Nandavanam Residence",
    defaultDate: "22 APRIL 2027",
    defaultBgColor: "#faf6ee",
    defaultTextColor: "#854d0e",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- Mango leaf garland along top -->
      <g fill="#15803d" stroke="#166534">
        <path d="M 80,0 Q 100,25 120,0 Z"/>
        <path d="M 120,0 Q 140,25 160,0 Z"/>
        <path d="M 1040,0 Q 1060,25 1080,0 Z"/>
        <path d="M 1080,0 Q 1100,25 1120,0 Z"/>
      </g>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "fam-annaprasanam",
    categoryId: "baby_family",
    name: "Silver Bowl Annaprasanam",
    tagline: "Auspicious silver bowl and peacock feather blessings",
    defaultSubtitle: "ANNAPRASANAM (FIRST RICE FEEDING)",
    defaultNames: "Baby Yashwant",
    defaultDate: "10 MAY 2027",
    defaultBgColor: "#f0fdf4",
    defaultTextColor: "#166534",
    defaultFontFamily: "Great Vibes",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "fam-family-tree",
    categoryId: "baby_family",
    name: "Family Reunion Golden Tree",
    tagline: "Majestic tree of life silhouette representing family generations",
    defaultSubtitle: "GRAND FAMILY REUNION",
    defaultNames: "The Sundaram Family",
    defaultDate: "25 DECEMBER 2026",
    defaultBgColor: "#292524",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgLaurel(150, 110, 0.9)}
      ${svgLaurel(1030, 110, 0.9, true)}
      ${renderTypography(p)}
    </svg>`
  },

  // --------------------------------------------------------------------------
  // 8. TEMPLE & CULTURAL (10 Templates)
  // --------------------------------------------------------------------------
  {
    id: "tem-gopuram-heritage",
    categoryId: "temple_cultural",
    name: "Temple Gopuram & Agal Vilakku",
    tagline: "Dravidian temple Gopuram silhouette & glowing agal deepams",
    defaultSubtitle: "MAHA KUMBABHISHEKAM",
    defaultNames: "Sri Kapaleeshwarar Temple",
    defaultDate: "14 SEPTEMBER 2026",
    defaultBgColor: "#450a0a",
    defaultTextColor: "#fef08a",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgTempleBell(150, 20, 0.85)}
      ${svgTempleBell(1030, 20, 0.85)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "tem-bharatanatyam",
    categoryId: "temple_cultural",
    name: "Salangai Bells & Nataraja",
    tagline: "Classical copper dance bells with red velvet pad",
    defaultSubtitle: "BHARATANATYAM ARANGETRAM",
    defaultNames: "Kum. Harini Raghuram",
    defaultDate: "29 NOVEMBER 2026",
    defaultBgColor: "#581c25",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Playfair Display",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgLotus(150, 150, 0.7)}
      ${svgLotus(1050, 150, 0.7)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "tem-karthigai-deepam",
    categoryId: "temple_cultural",
    name: "Glowing Golden Clay Diyas",
    tagline: "Rows of glowing earthen clay lamps casting warm sacred light",
    defaultSubtitle: "KARTHIGAI DEEPAM UTSAVAM",
    defaultNames: "Tiruvannamalai Maha Deepam",
    defaultDate: "26 NOVEMBER 2026",
    defaultBgColor: "#18181b",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgVilakku(140, 70, 0.8)}
      ${svgVilakku(1040, 70, 0.8)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "tem-temple-bell",
    categoryId: "temple_cultural",
    name: "Temple Bells & Marigolds",
    tagline: "Ornate hanging temple bells with fresh marigold flower garlands",
    defaultSubtitle: "SARVA JANA POOJA & BHAJAN",
    defaultNames: "Sri Raghavendra Swamy Seva",
    defaultDate: "18 OCTOBER 2026",
    defaultBgColor: "#faf6ee",
    defaultTextColor: "#78350f",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgTempleBell(150, 20, 0.85)}
      ${svgTempleBell(1030, 20, 0.85)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "tem-margazhi-kolam",
    categoryId: "temple_cultural",
    name: "Sacred Kolam Rangoli Radiance",
    tagline: "Intricate sacred geometric rice flour Kolam mandala aura",
    defaultSubtitle: "MARGAZHI UTSAVAM & MUSIC FESTIVAL",
    defaultNames: "Carnatic Music Season 2026",
    defaultDate: "16 DECEMBER 2026",
    defaultBgColor: "#1e1b4b",
    defaultTextColor: "#fde047",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <circle cx="150" cy="120" r="45" fill="none" stroke="#fde047" stroke-width="1.5" stroke-dasharray="6,4"/>
      <circle cx="1050" cy="120" r="45" fill="none" stroke="#fde047" stroke-width="1.5" stroke-dasharray="6,4"/>
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "tem-carnatic-veena",
    categoryId: "temple_cultural",
    name: "Carnatic Veena Classical",
    tagline: "Divine Saraswati Veena instrument with golden floral filigree",
    defaultSubtitle: "CARNATIC VEENA RECITAL",
    defaultNames: "Vidushi S. Rajeshwari",
    defaultDate: "05 JANUARY 2027",
    defaultBgColor: "#faf6ee",
    defaultTextColor: "#831843",
    defaultFontFamily: "Playfair Display",
    isItalic: true,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgLotus(150, 150, 0.7)}
      ${svgLotus(1050, 150, 0.7)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "tem-thiruvizha-chariot",
    categoryId: "temple_cultural",
    name: "Grand Ratham Temple Chariot",
    tagline: "Majestic golden temple chariot (Ther) festival grandeur",
    defaultSubtitle: "CHITHIRAI THIRUVIZHA RATHOTSAVAM",
    defaultNames: "Madurai Sri Meenakshi Sundareswarar",
    defaultDate: "21 APRIL 2027",
    defaultBgColor: "#7f1d1d",
    defaultTextColor: "#fef08a",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgVilakku(140, 70, 0.8)}
      ${svgVilakku(1040, 70, 0.8)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "tem-navratri-kalasam",
    categoryId: "temple_cultural",
    name: "Navratri Purna Kumbha",
    tagline: "Sacred brass Kalasam with coconut, mango leaves & kumkum",
    defaultSubtitle: "SRI SARADHA NAVRATRI MAHOTSAVAM",
    defaultNames: "Sri Sringeri Sharada Peetham",
    defaultDate: "01 OCTOBER 2026",
    defaultBgColor: "#fffbeb",
    defaultTextColor: "#b45309",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${svgVilakku(140, 80, 0.75)}
      ${svgVilakku(1040, 80, 0.75)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "tem-pongal-sugarcane",
    categoryId: "temple_cultural",
    name: "Pongal Pot, Sugarcane & Sun",
    tagline: "Overflowing brass Pongal pot with boiling milk, sugarcane & Surya",
    defaultSubtitle: "PONGAL THIRUNAAL VAZHTHUKAL",
    defaultNames: "Uzhavar Thirunaal 2027",
    defaultDate: "15 JANUARY 2027",
    defaultBgColor: "#fefce8",
    defaultTextColor: "#854d0e",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      ${renderTypography(p)}
    </svg>`
  },
  {
    id: "tem-arangetram-silk",
    categoryId: "temple_cultural",
    name: "Kanchipuram Silk Temple Border",
    tagline: "Rich Kanchipuram silk saree temple zari border (Korvai)",
    defaultSubtitle: "BHARATANATYAM ARANGETRAM RECITAL",
    defaultNames: "Kum. Shreya Natarajan",
    defaultDate: "19 DECEMBER 2026",
    defaultBgColor: "#4a044e",
    defaultTextColor: "#fef08a",
    defaultFontFamily: "Cinzel",
    isItalic: false,
    getSvg: (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 240" width="1200" height="240">
      ${COMMON_DEFS}
      ${renderBg(p.bgColor, 240)}
      <!-- Temple triangle zari border along top & bottom -->
      <g fill="#ca8a04">
        <polygon points="100,0 110,14 120,0"/><polygon points="120,0 130,14 140,0"/>
        <polygon points="1060,0 1070,14 1080,0"/><polygon points="1080,0 1090,14 1100,0"/>
      </g>
      ${renderTypography(p)}
    </svg>`
  },
];
