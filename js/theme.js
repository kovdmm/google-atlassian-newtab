// Background color.
// Chrome doesn't let extensions read its theme colors, so the background is picked in the settings.
// Empty – same as Chrome: light or dark by the browser mode (prefers-color-scheme).
// Loaded in <head>: the saved color is applied before the first paint, so the default background never flashes.

const BG_PRESETS = ["#202124", "#3c3c3c", "#1f2d3d", "#1e3326", "#3a2230", "#2d2640", "#ffffff", "#f1f3f4"];
const BG_CACHE_KEY = "jumpstart.bg"; // localStorage copy of settings.bg – readable synchronously at startup

const hexToRgb = hex => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
};
const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const mixHex = (rgb, to, amount) =>
  "#" + rgb.map((c, i) => Math.round(c + (to[i] - c) * amount).toString(16).padStart(2, "0")).join("");

function applyTheme(bg) {
  const root = document.documentElement;
  root.style.removeProperty("--bg");
  root.style.removeProperty("--tile");

  if (!/^#[0-9a-f]{6}$/i.test(bg || "")) {
    delete root.dataset.scheme;
    bg = "";
  } else {
    const rgb = hexToRgb(bg), dark = luminance(rgb) < 0.5;
    // text, logo and dialogs follow the brightness of the background, not Chrome's mode
    root.dataset.scheme = dark ? "dark" : "light";
    root.style.setProperty("--bg", bg);
    // shortcut circles are darker than the background, like Chrome (#3c3c3c → #2b2b2b)
    root.style.setProperty("--tile", dark ? mixHex(rgb, [0, 0, 0], 0.28) : mixHex(rgb, [0, 0, 0], 0.06));
  }

  try {
    if (bg) localStorage.setItem(BG_CACHE_KEY, bg);
    else localStorage.removeItem(BG_CACHE_KEY);
  } catch {}
}

try { applyTheme(localStorage.getItem(BG_CACHE_KEY)); } catch {}

// Page layout flags – compact view, the board shown, Atlassian connected – as classes on <html>.
// Same trick: a localStorage copy applied here, before the first paint, so the page never flashes the default
// layout and then jumps; applySettings() sets them again from the real settings
const LAYOUT_CACHE_KEY = "jumpstart.layout";
const LAYOUT_FLAGS = ["compact", "with-board", "atlassian"];

function applyLayout(flags) {
  LAYOUT_FLAGS.forEach(flag => document.documentElement.classList.toggle(flag, Boolean(flags[flag])));
  try { localStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(flags)); } catch {}
}

try { applyLayout(JSON.parse(localStorage.getItem(LAYOUT_CACHE_KEY)) || {}); } catch {}
