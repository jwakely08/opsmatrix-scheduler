// Building pictures (Josh, 2026-09-01): every building tile — the Explorer
// and every map's Building Picker — carries a picture. Eight preloaded
// renders ship with the app; a manager can also upload their own photo of
// the building. The choice is stored in opsmatrix_v7 → settings.buildingArt
// (keyed by building name), so it rides the existing workspace sync and
// backups with NO new store and NO new migration.
import type { ClassicData } from "./classicStore";

export interface BuildingPreset { id: string; label: string; url: string }

export const BUILDING_PRESETS: BuildingPreset[] = [
  { id: "b1", label: "Violet Campus", url: "./buildings/b1.webp" },
  { id: "b2", label: "Gold Campus", url: "./buildings/b2.webp" },
  { id: "b3", label: "Teal Clinic", url: "./buildings/b3.webp" },
  { id: "b4", label: "Sapphire Complex", url: "./buildings/b4.webp" },
  { id: "b5", label: "Emerald Office", url: "./buildings/b5.webp" },
  { id: "b6", label: "Amber Tower", url: "./buildings/b6.webp" },
  { id: "b7", label: "Azure Hospital", url: "./buildings/b7.webp" },
  { id: "b8", label: "Indigo Towers", url: "./buildings/b8.webp" }
];

type ArtMap = Record<string, string>; // building name → "preset:bN" | data URL

export function buildingArtMap(data: ClassicData): ArtMap {
  const settings = (data.v7.settings ?? {}) as { buildingArt?: unknown };
  const raw = settings.buildingArt;
  return raw && typeof raw === "object" ? (raw as ArtMap) : {};
}

/**
 * The picture for one building. A saved choice wins; otherwise a preset is
 * dealt deterministically from the building's name, so tiles look finished
 * before anyone has picked anything — and stay stable between visits.
 */
export function buildingArtUrl(building: string, art: ArtMap): string {
  const saved = art[building];
  if (saved) {
    if (saved.startsWith("preset:")) {
      const p = BUILDING_PRESETS.find((x) => x.id === saved.slice(7));
      if (p) return p.url;
    } else if (saved.startsWith("data:")) {
      return saved;
    }
  }
  let h = 0;
  for (let i = 0; i < building.length; i++) h = (h * 31 + building.charCodeAt(i)) | 0;
  return BUILDING_PRESETS[Math.abs(h) % BUILDING_PRESETS.length].url;
}

/** persist a choice ("preset:bN" or a data URL; "" clears back to automatic) */
export function setBuildingArt(data: ClassicData, building: string, value: string) {
  const settings = (data.v7.settings ?? (data.v7.settings = {})) as { buildingArt?: ArtMap };
  const map = { ...(settings.buildingArt ?? {}) };
  if (value) map[building] = value;
  else delete map[building];
  settings.buildingArt = map;
}

/**
 * An uploaded photo, shrunk to tile size (960w webp) so one phone picture
 * doesn't balloon localStorage or the sync payload.
 */
export function fileToBuildingArt(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const W = Math.min(960, img.naturalWidth || 960);
        const H = Math.round((img.naturalHeight / img.naturalWidth) * W) || 540;
        const cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        const ctx = cv.getContext("2d");
        if (!ctx) throw new Error("no canvas");
        ctx.drawImage(img, 0, 0, W, H);
        resolve(cv.toDataURL("image/webp", 0.8));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a picture this browser can read.")); };
    img.src = url;
  });
}
