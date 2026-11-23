// The print shop's inks, shirt colours and brush sizes.
// Shared by the server (which validates drawings) and both clients.

// Drawings are stored as integer coordinates on a COORD x COORD grid.
export const COORD = 1000;

export const INKS = [
  { hex: "#1f1b24", name: "Ink black" },
  { hex: "#fbf7ee", name: "Paper white" },
  { hex: "#e8382f", name: "Fire red" },
  { hex: "#ff7b1c", name: "Tangerine" },
  { hex: "#ffd31a", name: "Sunflower" },
  { hex: "#1fae5b", name: "Grass" },
  { hex: "#10b5b0", name: "Teal" },
  { hex: "#1d5fe0", name: "Royal blue" },
  { hex: "#7a45d8", name: "Violet" },
  { hex: "#ff5fa8", name: "Fluoro pink" },
  { hex: "#8b5a36", name: "Toast" },
  { hex: "#9b978f", name: "Pebble" },
];

// Shirt colours. `dark` decides whether slogans print light or dark on it.
export const SHIRTS = [
  { hex: "#f6f3ec", name: "Natural", dark: false },
  { hex: "#c9c6c0", name: "Heather", dark: false },
  { hex: "#232026", name: "Black", dark: true },
  { hex: "#1f2b4a", name: "Navy", dark: true },
  { hex: "#c7362f", name: "Red", dark: true },
  { hex: "#2d5b42", name: "Forest", dark: true },
  { hex: "#dfa52a", name: "Mustard", dark: false },
  { hex: "#92c5ea", name: "Sky", dark: false },
  { hex: "#f5a8c3", name: "Bubblegum", dark: false },
  { hex: "#b8a5e3", name: "Lilac", dark: false },
  { hex: "#ef7b30", name: "Tangerine", dark: false },
  { hex: "#a7dcc5", name: "Mint", dark: false },
];

// Brush widths in grid units.
export const SIZES = [9, 20, 40, 80];

// Limits, so one drawing can't swamp the server or the other phones.
export const LIMITS = {
  ops: 700, // strokes + fills
  coords: 14000, // numbers across all strokes (two per point)
  stroke: 2400, // numbers in one stroke
};

// Op kinds: [kind, ink, size, x0, y0, x1, y1, ...]
export const OP = { BRUSH: 0, ERASE: 1, FILL: 2 };
