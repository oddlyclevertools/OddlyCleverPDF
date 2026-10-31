// The looks: each one is a colour set for the whole app plus a live background scene.
// All original art, drawn in code (see scenes.js). `dark` sets the light/dark colour scheme.
export const LOOKS = [
  {
    id: "paper-desk", name: "Paper Desk", dark: false, scene: "paperDesk",
    blurb: "Warm paper, drifting pages and paper planes.",
    vars: {},
    swatch: ["#fff4e3", "#ff2e7e", "#16121b"],
  },
  {
    id: "ink-night", name: "Ink Night", dark: true, scene: "inkNight",
    blurb: "Ink blooms and gold dust on a midnight desk.",
    vars: {},
    swatch: ["#15111a", "#ff2e7e", "#ffc83d"],
  },
  {
    id: "blueprint", name: "Blueprint", dark: true, scene: "blueprint",
    blurb: "A drafting table that draws itself.",
    vars: {
      "--desk": "#0d2340", "--desk-dot": "rgba(160, 210, 255, 0.07)", "--card": "#123156", "--card-2": "#173b65", "--paper-hi": "#f2f8ff",
      "--text": "#e9f4ff", "--muted": "#9ebddc", "--line": "rgba(190, 225, 255, 0.16)", "--edge": "#cfe6ff",
      "--accent": "#4cc9ff", "--accent-ink": "#06213a", "--accent-soft": "#1c4a72",
      "--shadow-hard": "3px 3px 0 rgba(207, 230, 255, 0.75)", "--shadow-lift": "5px 6px 0 rgba(207, 230, 255, 0.85)",
    },
    swatch: ["#0d2340", "#4cc9ff", "#e9f4ff"],
  },
  {
    id: "neon-marker", name: "Neon Marker", dark: true, scene: "neonMarker",
    blurb: "Highlighter strokes glowing across the night.",
    vars: {
      "--desk": "#0b0b10", "--desk-dot": "rgba(255, 255, 255, 0.05)", "--card": "#15151d", "--card-2": "#1d1d29", "--paper-hi": "#fbfbf6",
      "--text": "#f4f4f8", "--muted": "#a9a9bc", "--line": "rgba(255, 255, 255, 0.13)", "--edge": "#f4f4f8",
      "--accent": "#c6ff3d", "--accent-ink": "#0b0b10", "--accent-soft": "#2c3612",
      "--shadow-hard": "3px 3px 0 rgba(198, 255, 61, 0.55)", "--shadow-lift": "5px 6px 0 rgba(198, 255, 61, 0.7)",
    },
    swatch: ["#0b0b10", "#c6ff3d", "#ff3df0"],
  },
  {
    id: "sunset-stack", name: "Sunset Stack", dark: false, scene: "sunsetStack",
    blurb: "Pages rising like lanterns into a peach sky.",
    vars: {
      "--desk": "#ffd8c4", "--desk-dot": "rgba(80, 30, 40, 0.06)", "--card": "#fff8f3", "--card-2": "#ffece1",
      "--text": "#2b1620", "--muted": "#7c5866", "--line": "rgba(43, 22, 32, 0.15)", "--edge": "#2b1620",
      "--accent": "#ff5631", "--accent-ink": "#ffffff", "--accent-soft": "#ffe0d5",
    },
    swatch: ["#ffd8c4", "#ff5631", "#8a5cff"],
  },
  {
    id: "mint-origami", name: "Mint Origami", dark: false, scene: "mintOrigami",
    blurb: "Folded paper boats sailing on soft mint.",
    vars: {
      "--desk": "#d6f4e8", "--desk-dot": "rgba(15, 42, 36, 0.07)", "--card": "#fbfffd", "--card-2": "#eafaf3",
      "--text": "#0f2a24", "--muted": "#4d7166", "--line": "rgba(15, 42, 36, 0.15)", "--edge": "#0f2a24",
      "--accent": "#0aa884", "--accent-ink": "#ffffff", "--accent-soft": "#cdf1e3",
    },
    swatch: ["#d6f4e8", "#0aa884", "#0f2a24"],
  },
];

export const lookById = (id) => LOOKS.find((l) => l.id === id) || LOOKS[0];
