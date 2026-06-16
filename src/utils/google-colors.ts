export interface GoogleEventColor {
  id: string;
  name: string;
  background: string;
}

/** Google Calendar event color IDs (colorId on events.insert/update). */
export const GOOGLE_EVENT_COLORS: GoogleEventColor[] = [
  { id: "1", name: "Lavender", background: "#7986cb" },
  { id: "2", name: "Sage", background: "#33b679" },
  { id: "3", name: "Grape", background: "#8e24aa" },
  { id: "4", name: "Flamingo", background: "#e67c73" },
  { id: "5", name: "Banana", background: "#f6bf26" },
  { id: "6", name: "Tangerine", background: "#f4511e" },
  { id: "7", name: "Peacock", background: "#039be5" },
  { id: "8", name: "Graphite", background: "#616161" },
  { id: "9", name: "Blueberry", background: "#3f51b5" },
  { id: "10", name: "Basil", background: "#0b8043" },
  { id: "11", name: "Tomato", background: "#d50000" },
];

export const DEFAULT_GOOGLE_EVENT_COLOR_ID = "8";

export function isValidGoogleEventColorId(colorId: string): boolean {
  return GOOGLE_EVENT_COLORS.some((color) => color.id === colorId);
}

export function googleEventColorName(colorId: string): string {
  return GOOGLE_EVENT_COLORS.find((color) => color.id === colorId)?.name ?? "Graphite";
}
