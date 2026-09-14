// OpsMatrix Hotels — the theme token set. The hospital skin (src/pro/pro.css)
// keeps its own navy/teal tokens untouched; this file is the hotel world:
// warm, luxurious, clean, sterile-precise underneath. theme.css reads these
// same values as CSS variables; /design renders every token so the look can
// be reviewed before data is wired.
export const hotelTheme = {
  color: {
    ivory: "#F7F3EC",      // page background
    sand: "#EDE5D8",       // surfaces
    tan: "#D9CDB8",        // borders
    espresso: "#2B2420",   // text
    taupe: "#7A6E62",      // secondary text
    gold: "#B8945A",       // accent
    goldLight: "#D4B77A",  // highlight
    // status — unmistakable, but inside the palette
    ready: "#4F7A5B",      // green: walk
    hold: "#C58F3D",       // amber: hold
    doNotWalk: "#9E3B36",  // red: do not walk
    unknown: "#8C8378"     // hatched, never gray-green
  },
  font: {
    serif: "'Cormorant Garamond', 'Playfair Display', Georgia, 'Times New Roman', serif",
    sans: "'Manrope', 'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif"
  },
  radius: { card: "14px", tile: "16px", chip: "999px", input: "12px" },
  shadow: {
    soft: "0 6px 22px rgba(43, 36, 32, 0.08)",
    lift: "0 14px 34px rgba(43, 36, 32, 0.14)"
  },
  motion: { fast: "160ms", base: "220ms", ease: "cubic-bezier(.2,.7,.2,1)" }
} as const;

export type VerdictLevel = "green" | "yellow" | "red" | "unknown";

export const VERDICT_LABEL: Record<VerdictLevel, string> = {
  green: "Ready — walk",
  yellow: "Hold",
  red: "Do not walk",
  unknown: "Unknown"
};

export const VERDICT_COLOR: Record<VerdictLevel, string> = {
  green: hotelTheme.color.ready,
  yellow: hotelTheme.color.hold,
  red: hotelTheme.color.doNotWalk,
  unknown: hotelTheme.color.unknown
};
