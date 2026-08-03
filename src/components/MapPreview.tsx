import { useMemo } from "react";
import type { FloorGeometry } from "../lib/types";
import { deriveShapes, polygonCentroid, type DeriveRoomInput } from "../lib/geometry";
import { COLOR_PALETTE } from "../lib/seeds";

/**
 * Static mini-map used during intake review: shows the auto-derived room
 * shapes immediately, with rooms that still need the trace tool marked.
 */
export function MapPreview({ geometry, rooms }: {
  geometry: FloorGeometry;
  rooms: (DeriveRoomInput & { name: string })[];
}) {
  const derived = useMemo(() => deriveShapes(geometry, rooms), [geometry, rooms]);

  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of geometry.walls) for (const p of w.points) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return { minX, minY, maxX, maxY };
  }, [geometry]);

  const W = 640, H = 300, pad = 18;
  const k = Math.min(
    (W - pad * 2) / Math.max(1, bounds.maxX - bounds.minX),
    (H - pad * 2) / Math.max(1, bounds.maxY - bounds.minY)
  );
  const tx = (W - (bounds.minX + bounds.maxX) * k) / 2;
  const ty = (H + (bounds.minY + bounds.maxY) * k) / 2;

  const wallsPath = geometry.walls
    .map((w) => w.points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ") + " Z")
    .join(" ");

  return (
    <svg className="mappreview" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <g transform={`translate(${tx} ${ty}) scale(${k} ${-k})`}>
        {rooms.map((r, i) => {
          const s = derived.shapes[r.id];
          if (!s) return null;
          const ring = (poly: [number, number][]) =>
            poly.map((p, j) => `${j === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ") + " Z";
          return (
            <path key={r.id} className="roomfill" fillRule="evenodd"
              fill={COLOR_PALETTE[i % COLOR_PALETTE.length]}
              d={[ring(s.outer), ...s.holes.map(ring)].join(" ")} />
          );
        })}
        <path className="wallsP" d={wallsPath} style={{ filter: "none" }} />
      </g>
      {/* labels in screen space so they stay upright and readable */}
      {rooms.map((r) => {
        const s = derived.shapes[r.id];
        if (!s) return null;
        const [cx, cy] = polygonCentroid(s.outer);
        return (
          <text key={"t" + r.id} x={tx + cx * k} y={ty - cy * k}
            textAnchor="middle" dominantBaseline="middle"
            style={{ font: "600 10px 'Segoe UI', sans-serif", fill: "#fff", pointerEvents: "none" }}>
            {r.name}
          </text>
        );
      })}
    </svg>
  );
}
