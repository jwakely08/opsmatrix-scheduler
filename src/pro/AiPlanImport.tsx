// The ONE front door for floor plans (picture, PDF, or CAD/DXF). One
// consistent order, every time (Josh's spec, 2026-08-28):
//   1. Building + floor.
//   2. THE QUESTION — does the file state room sizes?
//      • Yes → Max reads everything, plan arrives to scale (unchanged flow).
//      • No  → the PLAN STUDIO opens: trace a room you know with the snap
//        engine, type its square footage (that's the calibration), then let
//        Max draw the rest — sized from YOUR calibration, every AI shape
//        draggable and re-snappable. Max never reads before you calibrate.
//   3. Either way the plan is rebuilt matrix-style; the upload is never
//      shown back.
import React, { useEffect, useRef, useState } from "react";
import { readPlanWithAI, readPlanTiled, locateDrawing, padBox, AiPlanError } from "../bridge/aiPlanImport";
import { tilesForPicture, mergeTileRooms, TILE_RENDER_EDGE } from "./planTiles";
import { createPortal } from "react-dom";
import { planFileToImage, isPdf } from "./planFile";
import { dxfToPicture, dxfSegments, dxfTransform, segmentBounds, isDxf, isDwg } from "./dxfRaster";
import { parseCad, buildCadRooms, cadLooksStructured } from "./cadImport";
import { isOmfloor, readOmfloor, omfloorToDxf } from "./omfloorImport";
import { knownPlaces, nextFloorName, placeKey, type KnownAccount } from "./placeNames";
import { scopeLabelFor } from "./studioIngest";
import type { StudioShapeData } from "./studioSets";
import { loadApiKey, saveApiKey } from "./classicStore";
import { aiProxy } from "./aiTransport";
import { PlanStudio, type StudioPicture, type AiRoomSeed } from "./PlanStudio";
import type { ClassicData } from "./classicStore";
import type { Rules } from "./rules";

type Phase = "form" | "working" | "done" | "error";
// "cad" (Josh, 2026-10-20: "no workarounds"): a CAD drawing that carries its
// rooms as data comes straight in — no question about sizes, no API key, and
// it is NEVER handed to Max: a drawing without room data is refused, not read
type ReadMode = "read" | "calibrate" | "cad";

// Account and building are PICKED from what OpsMatrix already has (Josh, 2026-10-20: a floor
// typed into "fairview" became a second building beside "Fairview"). The last place used — or the
// only one there is — comes pre-selected; "＋ New…" types a new one, and a typed name that matches
// an existing place in all but capitals/spacing becomes that place.
const NEW_PLACE = "\u0000new";
const LAST_PLACE = "opsmatrix_upload_place";

function readPlaces(): KnownAccount[] {
  try {
    const v7 = JSON.parse(localStorage.getItem("opsmatrix_v7") ?? "{}") ?? {};
    return knownPlaces(Array.isArray(v7.spaces) ? v7.spaces : []);
  } catch { return []; }
}

/** what the device already knows about the account (before any room has one) */
function prefillAccount(): string {
  try {
    const v7 = JSON.parse(localStorage.getItem("opsmatrix_v7") ?? "{}") ?? {};
    const systems = [...new Set(((v7.spaces ?? []) as { system?: string }[])
      .map((sp) => String(sp.system ?? "").trim()).filter(Boolean))];
    if (systems.length === 1) return systems[0];
    return String((v7.settings ?? {}).orgName ?? (v7.settings ?? {}).campus ?? "").trim();
  } catch { return ""; }
}

/** the last place used if it's still here, else the only account / building there is */
function startingPlace(places: KnownAccount[]): { account: string; building: string } {
  let last: { account?: string; building?: string } = {};
  try { last = JSON.parse(localStorage.getItem(LAST_PLACE) ?? "{}") ?? {}; } catch { /* none yet */ }
  const prefill = prefillAccount();
  const acc = places.find((a) => placeKey(a.name) === placeKey(last.account)) ??
    (places.length === 1 ? places[0] : places.find((a) => placeKey(a.name) === placeKey(prefill)));
  if (!acc) return { account: prefill, building: "" };
  const b = acc.buildings.find((x) => placeKey(x.name) === placeKey(last.building)) ??
    (acc.buildings.length === 1 ? acc.buildings[0] : undefined);
  return { account: acc.name, building: b?.name ?? "" };
}

export function AiPlanImport({ commit, onImported, open, onClose, defaultMode, rules }: {
  commit: (mut: (d: ClassicData) => void) => void;
  onImported: () => void;
  open: boolean;
  onClose: () => void;
  /** open straight into one mode (e.g. classic's "no sizes" tile, or the
      upload hub's "CAD drawing" tile) */
  defaultMode?: ReadMode;
  rules: Rules;
}) {
  const [phase, setPhase] = useState<Phase>("form");
  const [step, setStep] = useState<"choice" | "form">(defaultMode ? "form" : "choice");
  const [mode, setMode] = useState<ReadMode>(defaultMode ?? "read");
  const [studioPic, setStudioPic] = useState<StudioPicture | null>(null);
  const [studioSeeds, setStudioSeeds] = useState<AiRoomSeed[]>([]);
  const [studioNotice, setStudioNotice] = useState("");
  const [studioSized, setStudioSized] = useState(false);
  // structured CAD import: exact shapes transcribed from the file's own data
  const [studioExact, setStudioExact] = useState<Omit<StudioShapeData, "id">[] | null>(null);
  // the hierarchy is entered UP FRONT (Josh: account → building → floor,
  // departments are chosen per room later), picked from the places already here
  const [places, setPlaces] = useState<KnownAccount[]>(() => readPlaces());
  const [account, setAccount] = useState(() => startingPlace(places).account);
  const [building, setBuilding] = useState(() => startingPlace(places).building);
  const [floor, setFloor] = useState("");
  const [typingAccount, setTypingAccount] = useState(false);
  const [typingBuilding, setTypingBuilding] = useState(false);
  // every time the form opens: the places as they are now, and where the last floor went
  useEffect(() => {
    if (!open) return;
    const p = readPlaces();
    const start = startingPlace(p);
    setPlaces(p);
    setAccount(start.account);
    setBuilding(start.building);
    setFloor("");
    setTypingAccount(false);
    setTypingBuilding(false);
  }, [open]);
  const accountHit = places.find((a) => placeKey(a.name) === placeKey(account));
  const buildingHit = accountHit?.buildings.find((b) => placeKey(b.name) === placeKey(building));
  const floorHit = buildingHit?.floors.find((f) => placeKey(f.name) === placeKey(floor));
  const nextFloor = buildingHit ? nextFloorName(buildingHit.floors) : "";
  /** the names as they'll be filed: an existing place's own spelling wins */
  const settleNames = () => {
    setAccount(accountHit?.name ?? account.trim());
    setBuilding(buildingHit?.name ?? building.trim());
    setFloor(floorHit?.name ?? floor.trim());
  };
  const [apiKey, setApiKey] = useState<string>(() => loadApiKey());
  const [keySaved, setKeySaved] = useState<boolean>(() => Boolean(loadApiKey()));
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ rooms: number; printed: number; scaled: boolean; calibrated: boolean } | null>(null);
  // cloud accounts: AI reading is included — the server holds the key
  const [proxied, setProxied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void aiProxy().then((p) => setProxied(Boolean(p))); }, []);

  const close = () => {
    setPhase("form");
    setStep(defaultMode ? "form" : "choice");
    setMode(defaultMode ?? "read");
    setStudioPic(null);
    setStudioExact(null);
    setError(""); setStatus(""); setResult(null);
    onClose();
  };

  // There is no second write path any more: EVERY plan — read or calibrated —
  // is shipped by the Calibration Editor (PlanStudio.ship), so the manager
  // always sees and approves the rooms before they land in Max Space.

  /** any accepted file → a picture (photos, PDFs rasterised, DXF drawn) */
  async function fileToPicture(file: File) {
    if (isDwg(file)) {
      throw new AiPlanError(
        "DWG is a closed format this browser can't open — but the SAME file saved as DXF often carries " +
        "every room's number, name and exact size as data OpsMatrix reads perfectly. In any CAD program " +
        "(or the free ODA File Converter): File → Save As → DXF (ASCII), then upload that."
      );
    }
    if (isDxf(file)) {
      setStatus("Drawing the CAD file…");
      return { ...dxfToPicture(await file.text()), renderRegion: undefined };
    }
    setStatus(isPdf(file) ? "Opening the PDF…" : "Opening the image…");
    return planFileToImage(file);
  }

  async function handleFile(file: File) {
    setPhase("working");
    setError("");
    try {
      if (mode === "cad" && !isDxf(file) && !isOmfloor(file)) {
        throw new AiPlanError(isDwg(file)
          ? "That's the DWG drawing itself — open it in the CAD converter first, then pick the floor file it saves (.omfloor)."
          : "That isn't a floor file. Pick the floor's .omfloor file from the CAD converter (or a .dxf) — or go back and choose the picture or PDF option.");
      }
      // ── the structured CAD path (Josh, 2026-09-12): a facilities-managed
      // DXF carries room boundaries and tags as DATA. When that structure is
      // there we TRANSCRIBE it — exact shapes, numbers, names and square
      // footage, no AI read at all. Anything less structured falls through
      // to the normal picture → Max pipeline below. A floor file from our CAD
      // converter (.omfloor) takes this same path, written out as that DXF.
      if (isDxf(file) || isOmfloor(file)) {
        const text = isOmfloor(file) ? omfloorToDxf(await readOmfloor(file)) : await file.text();
        setStatus("Reading the CAD data…");
        const built = buildCadRooms(parseCad(text));
        if (cadLooksStructured(built)) {
          setStatus("Drawing the CAD file…");
          // a whole hospital floor at the default 2000px is ~2px/ft — mush
          // when zoomed. CAD knows its real size, so draw at ~4px/ft
          // (capped: a 4800px PNG of thin lines still compresses small)
          const segs = dxfSegments(text);
          const sb = segmentBounds(segs);
          const longFt = Math.max(sb.maxX - sb.minX, sb.maxY - sb.minY) * built.ftPerUnit;
          const edge = Math.min(4800, Math.max(2000, Math.round(longFt * 4)));
          const pic = dxfToPicture(text, edge);
          const tr = dxfTransform(segs, edge);
          const exact: Omit<StudioShapeData, "id">[] = built.rooms.map((r) => ({
            pts: r.pts.map((p) => tr.toPx(p.x, p.y)),
            roomNumber: r.roomNumber,
            roomName: r.roomName,
            // the file's usage words map into the account's own Scope
            // vocabulary; anything unknown stays blank = Needs review
            roomType: scopeLabelFor(rules, r.roomType),
            floorType: "", fixtureCount: 0, department: "",
            knownSqFt: r.sqFt > 0 ? r.sqFt : null,
            source: "ai"
          }));
          const named = exact.filter((s) => s.roomNumber).length;
          // the usages Scope doesn't know yet — named so the manager can add
          // them as room types (or pick per room); they ship as Needs review,
          // never as a silently wrong price
          const unknown: Record<string, number> = {};
          for (const s of exact) {
            if (s.roomName && !s.roomType) unknown[s.roomName] = (unknown[s.roomName] ?? 0) + 1;
          }
          const unkTop = Object.entries(unknown).sort((a, b) => b[1] - a[1]);
          const unkNote = unkTop.length
            ? ` ${unkTop.reduce((n, [, c]) => n + c, 0)} rooms use words Scope doesn't know yet (` +
            unkTop.slice(0, 5).map(([u, c]) => (c > 1 ? `${u} ×${c}` : u)).join(", ") +
            (unkTop.length > 5 ? ", …" : "") +
            ") — they'll show as Needs review; add them as room types in Scope, or pick a type per room."
            : "";
          setPhase("form");
          setStudioSeeds([]);
          setStudioExact(exact);
          setStudioSized(true);
          setStudioNotice(
            `✓ Read ${exact.length} rooms straight from the CAD data — ` +
            `${named} numbered, square footage exact from the drawing` +
            (built.unlabeled > 0 ? ` (${built.unlabeled} unlabeled space${built.unlabeled === 1 ? "" : "s"} need names)` : "") +
            ". Nothing was guessed: check the drawing, then 🚀 Ship to Max Space." + unkNote);
          setStudioPic({ dataUrl: pic.dataUrl, width: pic.width, height: pic.height, aspect: pic.aspect });
          return;
        }
      }
      if (mode === "cad" || isOmfloor(file)) {
        throw new AiPlanError(
          "This file doesn't carry room data OpsMatrix can read exactly (numbered room outlines), " +
          "so nothing was brought in. To have Max read a drawing as a picture instead, go back and choose the picture or PDF option."
        );
      }
      const picture = await fileToPicture(file);

      // BOTH modes go through the Calibration Editor now (Josh, 2026-08-31:
      // "I want the same process in place, the same editor and everything,
      // for when you upload floor plans or CAD files WITH information — the
      // only difference is all the data is preloaded"). Max reads first;
      // the editor opens with whatever it found, and approval happens on
      // 🚀 Ship to Max Space either way.
      const key = apiKey.trim();
      if (key && key !== loadApiKey()) saveApiKey(key);
      const proxy = await aiProxy();
      let seeds: AiRoomSeed[] = [];
      let noticeMsg = "";
      let read = false;
      // BOTH modes (Josh, 2026-09-01 / benchmark 2026-09-03): the sheet often
      // carries legends, title blocks and notes — Max first LOCATES the floor
      // plan itself and the rest of the page is cropped away, so only the
      // interior rooms are read, the tiles subdivide the DRAWING rather than
      // the page, and only the drawing shows in the editor
      let pic = picture;
      if (key || proxy) {
        try {
          setStatus("Max is finding the floor plan on the page…");
          const box = await locateDrawing({ apiKey: key, proxy, imageDataUrl: picture.dataUrl });
          const rr = (picture as { renderRegion?: (b: ReturnType<typeof padBox>, t: number) => Promise<typeof picture> }).renderRegion;
          if (box && rr) pic = await rr(padBox(box), 2576);
        } catch { /* the crop is an optimisation — read the full page instead */ }
      }
      if (key || proxy) {
        try {
          setStatus(mode === "read" ? "Max is reading the floor plan…" : "Max is drawing the floor plan…");
          // dense sheets (hundreds of rooms on one page) are read in TILES —
          // each re-rendered at full resolution and merged back together. The
          // sheet's own printed-label size decides; a normal plan stays one shot.
          const rr2 = (pic as { renderRegion?: (b: ReturnType<typeof padBox>, t: number) => Promise<typeof pic> }).renderRegion;
          const { tiles } = rr2
            ? await tilesForPicture(pic.dataUrl, pic.width, pic.height)
            : { tiles: [{ x0: 0, y0: 0, x1: 1, y1: 1 }] };
          const reading = tiles.length > 1 && rr2
            ? await readPlanTiled({
              apiKey: key, proxy,
              imageDataUrl: pic.dataUrl,
              imageWidth: pic.width, imageHeight: pic.height,
              building, floor, onProgress: setStatus,
              tiles, renderRegion: rr2, tileEdge: TILE_RENDER_EDGE, merge: mergeTileRooms
            })
            : await readPlanWithAI({
              apiKey: key, proxy,
              imageDataUrl: pic.dataUrl,
              imageWidth: pic.width, imageHeight: pic.height,
              building, floor, onProgress: setStatus
            });
          seeds = reading.rooms.map((r) => ({
            name: r.name, roomNumber: r.roomNumber, roomType: r.roomType, polygon: r.polygon,
            // read mode keeps the sizes stated on the plan; calibrate mode
            // ignores them (there weren't any to state)
            squareFeet: mode === "read" ? r.squareFeet : 0
          }));
          read = mode === "read" && seeds.some((s) => Number(s.squareFeet) > 0);
          if (mode === "read" && !read) {
            noticeMsg = "Max didn't find a square footage stated for any room. " +
              "Calibrate up to three rooms you know instead, then measure them all.";
          }
        } catch (e) {
          noticeMsg = "Max couldn't read this plan (" +
            (e instanceof AiPlanError ? e.message : String((e as Error)?.message ?? e)) +
            ") — trace the rooms by hand, or try ✨ Max draws the rooms again.";
        }
      } else {
        noticeMsg = "No API key saved, so Max can't draw yet — trace the rooms by hand, or save a key and use ✨ Max draws the rooms.";
      }
      setPhase("form");
      setStudioSeeds(seeds);
      setStudioNotice(noticeMsg);
      setStudioSized(read);
      setStudioPic({
        dataUrl: pic.dataUrl, width: pic.width,
        height: pic.height, aspect: pic.aspect,
        // keep the source re-render hook so "✨ Max draws the rooms" inside
        // the editor can read dense sheets in tiles too
        renderRegion: (pic as StudioPicture).renderRegion
      });
    } catch (e) {
      setError(e instanceof AiPlanError ? e.message : String((e as Error)?.message || e));
      setPhase("error");
    }
  }

  if (!open) return null;

  // the Calibration Editor is full-screen and owns the whole flow —
  // including shipping to Max Space and saving the editable set
  if (studioPic) {
    return (
      <PlanStudio picture={studioPic} account={account} building={building} floor={floor}
        rules={rules} initialAiRooms={studioSeeds} initialExactShapes={studioExact ?? undefined}
        initialNotice={studioNotice}
        sizesFromFile={studioSized}
        onShipped={(rooms, setSaved, planSaved) => {
          setStudioPic(null);
          setStudioExact(null);
          // the next floor most likely goes to the same account and building
          try { localStorage.setItem(LAST_PLACE, JSON.stringify({ account, building })); } catch { /* not remembered */ }
          setResult({ rooms, printed: rooms, scaled: true, calibrated: true });
          if (planSaved === false) setStatus("The rooms are in, but this device ran out of storage space for the floor's picture — this floor has no map.");
          else if (!setSaved) setStatus("Note: the editable calibration set could not be saved (storage full) — the floor plan itself is in.");
          else setStatus("");
          setPhase("done");
        }}
        onCancel={() => setStudioPic(null)} />
    );
  }

  return createPortal(
    <>
      {(
        <div className="pro-modalback" onClick={(e) => {
          if (e.target === e.currentTarget && phase !== "working") close();
        }}>
          <div className="pro-modal aiplan">
            <div className="pshead">
              <h2>{mode === "cad" && step === "form" ? "🗂 CAD floor with room data" : "🗺 Upload a floor plan"}</h2>
              {phase !== "working" && <button className="pbtn ghost" onClick={close}>✕</button>}
            </div>

            {(phase === "form" || phase === "error") && step === "choice" && (
              <>
                <button className="upltile" onClick={() => { setMode("cad"); setStep("form"); }}>
                  <b>🗂 CAD floor with room data (.omfloor or DXF)</b>
                  <span>
                    A floor file from our CAD converter (.omfloor), or a CAD drawing that carries its rooms
                    (.dxf). Every room, number, name and square foot comes straight from the file — exact,
                    nothing guessed. No AI and no API key.
                  </span>
                </button>
                <p className="pnote">
                  For a picture or PDF, one question first: does the file state its measurements —
                  room sizes or square footage readable on the plan?
                </p>
                <button className="upltile" onClick={() => { setMode("read"); setStep("form"); }}>
                  <b>✨ Yes — the sizes are in the file</b>
                  <span>
                    Max reads the rooms, numbers and square footage, then the Calibration Editor
                    opens with everything already filled in — check it over and ship it.
                  </span>
                </button>
                <button className="upltile" onClick={() => { setMode("calibrate"); setStep("form"); }}>
                  <b>📐 No — it's just the floor plan, no sizes</b>
                  <span>
                    Max draws every room first, automatically. Then the Calibration Editor opens:
                    correct the drawing (move, reshape, merge, trace), calibrate up to three rooms
                    you KNOW, and measure everything from your calibration.
                  </span>
                </button>
              </>
            )}

            {(phase === "form" || phase === "error") && step === "form" && (
              <>
                <p className="pnote">
                  {mode === "cad"
                    ? "Pick the floor file — the .omfloor from our CAD converter, or a CAD drawing with room data (.dxf). Every room comes straight from its data — exact outlines, numbers, names and square footage — and the Calibration Editor opens with all of it filled in, ready to check and ship. Nothing is sent to Max, so no API key is needed."
                    : mode === "calibrate"
                    ? "Pick the file — picture, PDF, or CAD (DXF). Max draws the rooms first; the Calibration Editor opens with them ready to correct."
                    : "Pick the file — picture, PDF, or CAD (DXF). Max reads the rooms, their numbers and the stated square footage; the Calibration Editor opens with all of it filled in, ready to check and ship."}
                </p>

                {/* the hierarchy, up front: account → building → floor.
                    Departments are picked per room later, in the editor. */}
                <div className="prow">
                  <label className="pfield">Account <small>your hospital system</small>
                    {places.length > 0 && !typingAccount ? (
                      <select value={accountHit?.name ?? ""} onChange={(e) => {
                        if (e.target.value === NEW_PLACE) {
                          setTypingAccount(true); setTypingBuilding(true); setAccount(""); setBuilding("");
                          return;
                        }
                        const picked = places.find((a) => a.name === e.target.value);
                        setAccount(e.target.value);
                        setBuilding(picked && picked.buildings.length === 1 ? picked.buildings[0].name : "");
                        setTypingBuilding(false);
                      }}>
                        {!accountHit && <option value="">Pick the account…</option>}
                        {places.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
                        <option value={NEW_PLACE}>＋ New account…</option>
                      </select>
                    ) : (
                      <input value={account} placeholder="e.g. Summa Health" autoFocus={typingAccount}
                        onChange={(e) => setAccount(e.target.value)}
                        onBlur={() => { if (accountHit) { setAccount(accountHit.name); setTypingAccount(false); } }} />
                    )}
                  </label>
                  <label className="pfield">Building
                    {accountHit && accountHit.buildings.length > 0 && !typingBuilding ? (
                      <select value={buildingHit?.name ?? ""} onChange={(e) => {
                        if (e.target.value === NEW_PLACE) { setTypingBuilding(true); setBuilding(""); return; }
                        setBuilding(e.target.value);
                      }}>
                        {!buildingHit && <option value="">Pick the building…</option>}
                        {accountHit.buildings.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
                        <option value={NEW_PLACE}>＋ New building…</option>
                      </select>
                    ) : (
                      <input value={building} placeholder="e.g. Crawfordsville" autoFocus={typingBuilding && !typingAccount}
                        onChange={(e) => setBuilding(e.target.value)}
                        onBlur={() => { if (buildingHit) { setBuilding(buildingHit.name); setTypingBuilding(false); } }} />
                    )}
                  </label>
                  <label className="pfield">Floor
                    <input value={floor} placeholder={nextFloor || "e.g. 2nd Floor"} list="plan-floor-names"
                      onChange={(e) => setFloor(e.target.value)}
                      onBlur={() => { if (floorHit) setFloor(floorHit.name); }} />
                    <datalist id="plan-floor-names">
                      {(buildingHit?.floors ?? []).map((f) => <option key={f.name} value={f.name} />)}
                    </datalist>
                  </label>
                </div>
                {buildingHit && buildingHit.floors.length > 0 && (
                  <p className="pnote">
                    Already in {buildingHit.name}: {buildingHit.floors.map((f) => f.name).join(", ")}.
                    {!floor.trim() && nextFloor && (
                      <> <button className="plink" onClick={() => setFloor(nextFloor)}>Use “{nextFloor}”</button></>
                    )}
                  </p>
                )}
                {floorHit && buildingHit && (
                  <p className="warntext">⚠ {floorHit.name} is already in {buildingHit.name} — this file updates its rooms (matched by room number).</p>
                )}

                {mode === "cad" ? null : proxied ? (
                  <p className="pnote keysaved">✓ AI reading is included with your OpsMatrix account.</p>
                ) : keySaved ? (
                  <p className="pnote keysaved">
                    ✓ API key saved on this device{apiKey.length > 4 ? ` (…${apiKey.slice(-4)})` : ""} ·{" "}
                    <button className="plink" onClick={() => { setKeySaved(false); setApiKey(""); }}>change</button>
                  </p>
                ) : (
                  <label className="pfield">Anthropic API key{mode === "calibrate" ? <small>needed only for "Max draws the rest"</small> : null}
                    <span className="keyrow">
                      <input type="password" value={apiKey} placeholder="sk-ant-api…"
                        onChange={(e) => setApiKey(e.target.value)} />
                      <button className="pbtn primary" disabled={!apiKey.trim()}
                        onClick={() => { saveApiKey(apiKey); setKeySaved(true); }}>
                        Save
                      </button>
                    </span>
                    <small>
                      Saved on this device only, and shared with Max AI in OpsMatrix — enter it once.
                      It is never sent anywhere except Anthropic.
                    </small>
                  </label>
                )}

                {error && <p className="warntext">⚠ {error}</p>}

                <button className="pbtn primary wide"
                  disabled={!account.trim() || !building.trim() || !floor.trim() || (mode === "read" && !keySaved && !proxied)}
                  onClick={() => { settleNames(); fileRef.current?.click(); }}>
                  {mode === "cad" ? "Choose the floor file (.omfloor or .dxf)" : mode === "calibrate" ? "Choose the file — open the Calibration Editor" : "Choose floor plan (image, PDF or DXF)"}
                </button>
                {(!account.trim() || !building.trim() || !floor.trim()) &&
                  <small className="pnote">Fill in account, building and floor first — that's where this plan files itself.</small>}
                {!(!account.trim() || !building.trim() || !floor.trim()) && mode === "read" && !keySaved && !proxied &&
                  <small className="pnote">Save the API key above first — one time only.</small>}
                <p className="pnote">
                  <button className="plink" onClick={() => setStep("choice")}>‹ Back to the question</button>
                </p>

                {/* CAD: no type filter — iPads can grey out .dxf files they don't recognise;
                    the file is checked as soon as it's picked */}
                <input ref={fileRef} type="file" style={{ display: "none" }}
                  accept={mode === "cad" ? undefined : "image/*,application/pdf,.pdf,.dxf,.dwg"}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) handleFile(f);
                  }} />
              </>
            )}

            {phase === "working" && (
              <div className="aiworking">
                <div className="aispin" />
                <b>{status || "Working…"}</b>
                <small>
                  Reading a plan carefully takes up to a couple of minutes. Leave this open.
                </small>
              </div>
            )}

            {phase === "done" && result && (
              <>
                <p className="pnote big">✓ {result.rooms} rooms on the new floor plan.</p>
                {status && <p className="warntext">⚠ {status}</p>}
                <p className="pnote">
                  Shipped to Max Space — drawn in OpsMatrix's own style, every room measured, and
                  filed under {[account, building, floor].filter(Boolean).join(" → ")}. The set
                  stays editable in Max Space → Calibration Editor.
                </p>
                <p className="pnote">
                  Check the room numbers and types on the map, then start tapping rooms onto schedules.
                </p>
                <button className="pbtn primary wide" onClick={() => { close(); onImported(); }}>
                  Open the plan
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
