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
import { importPlanFromImage, readPlanWithAI, AiPlanError, type ImportResult } from "../bridge/aiPlanImport";
import { attachPlanToRooms } from "./roomListImport";
import { planFileToImage, isPdf } from "./planFile";
import { dxfToPicture, isDxf, isDwg } from "./dxfRaster";
import { loadApiKey, saveApiKey } from "./classicStore";
import { aiProxy } from "./aiTransport";
import { PlanStudio, type StudioPicture, type AiRoomSeed } from "./PlanStudio";
import type { ClassicData } from "./classicStore";
import type { Rules } from "./rules";

type Phase = "form" | "working" | "done" | "error";
type ReadMode = "read" | "calibrate";

export function AiPlanImport({ commit, onImported, open, onClose, defaultMode, rules }: {
  commit: (mut: (d: ClassicData) => void) => void;
  onImported: () => void;
  open: boolean;
  onClose: () => void;
  /** open straight into one mode (e.g. classic's "no sizes" tile) */
  defaultMode?: ReadMode;
  rules: Rules;
}) {
  const [phase, setPhase] = useState<Phase>("form");
  const [step, setStep] = useState<"choice" | "form">(defaultMode ? "form" : "choice");
  const [mode, setMode] = useState<ReadMode>(defaultMode ?? "read");
  const [studioPic, setStudioPic] = useState<StudioPicture | null>(null);
  const [studioSeeds, setStudioSeeds] = useState<AiRoomSeed[]>([]);
  const [studioNotice, setStudioNotice] = useState("");
  // the hierarchy is entered UP FRONT (Josh: account → building → floor,
  // departments are chosen per room later): account prefills from what the
  // device already knows
  const [account, setAccount] = useState(() => {
    try {
      const v7 = JSON.parse(localStorage.getItem("opsmatrix_v7") ?? "{}") ?? {};
      const systems = [...new Set(((v7.spaces ?? []) as { system?: string }[])
        .map((sp) => String(sp.system ?? "").trim()).filter(Boolean))];
      if (systems.length === 1) return systems[0];
      return String((v7.settings ?? {}).orgName ?? (v7.settings ?? {}).campus ?? "").trim();
    } catch { return ""; }
  });
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
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
    setError(""); setStatus(""); setResult(null);
    onClose();
  };

  /** write a READ-mode import into the stores (the Studio ships itself) */
  function persist(imported: ImportResult, calibrated: boolean) {
    for (const sp of imported.spaces) (sp as { system?: string }).system = account;
    commit((d) => {
      // rooms already imported from a room list get the GEOMETRY attached
      // to them — a later floor plan never duplicates existing rooms
      d.v7.spaces = d.v7.spaces ?? [];
      attachPlanToRooms(d.v7.spaces as never, imported as never);
      d.plans.push(imported.plan as never);
      localStorage.setItem("opsmatrix_v7_plans", JSON.stringify(d.plans));
    });
    const printed = imported.spaces.filter((s) => Number(s.squareFeet) > 0).length;
    setResult({
      rooms: imported.spaces.length,
      printed,
      scaled: Boolean((imported.plan as { ratio?: number }).ratio),
      calibrated
    });
    setStudioPic(null);
    setPhase("done");
  }

  /** any accepted file → a picture (photos, PDFs rasterised, DXF drawn) */
  async function fileToPicture(file: File) {
    if (isDwg(file)) {
      throw new AiPlanError(
        "DWG is a closed format this browser can't open. Export the drawing as DXF or as a PDF and upload that instead."
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
      const picture = await fileToPicture(file);

      if (mode === "calibrate") {
        // Max draws EVERYTHING first, automatically (Josh, rev 2) — the
        // editor then opens with the boxes ready to correct. No key or an
        // unreadable plan is not a dead end: the editor opens empty and
        // tracing by hand still works.
        const key = apiKey.trim();
        if (key && key !== loadApiKey()) saveApiKey(key);
        const proxy = await aiProxy();
        let seeds: AiRoomSeed[] = [];
        let noticeMsg = "";
        if (key || proxy) {
          try {
            setStatus("Max is drawing the floor plan…");
            const reading = await readPlanWithAI({
              apiKey: key, proxy,
              imageDataUrl: picture.dataUrl,
              imageWidth: picture.width, imageHeight: picture.height,
              building, floor, onProgress: setStatus
            });
            seeds = reading.rooms.map((r) => ({
              name: r.name, roomNumber: r.roomNumber, roomType: r.roomType, polygon: r.polygon
            }));
          } catch (e) {
            noticeMsg = "Max couldn't draw this plan (" +
              (e instanceof AiPlanError ? e.message : String((e as Error)?.message ?? e)) +
              ") — trace the rooms by hand, or try ✨ Max draws the rooms again.";
          }
        } else {
          noticeMsg = "No API key saved, so Max can't draw yet — trace the rooms by hand, or save a key and use ✨ Max draws the rooms.";
        }
        setPhase("form");
        setStudioSeeds(seeds);
        setStudioNotice(noticeMsg);
        setStudioPic({
          dataUrl: picture.dataUrl, width: picture.width,
          height: picture.height, aspect: picture.aspect
        });
        return;
      }

      const key = apiKey.trim();
      if (key && key !== loadApiKey()) saveApiKey(key);
      const proxy = await aiProxy();
      const imported = await importPlanFromImage({
        apiKey: key,
        proxy,
        imageDataUrl: picture.dataUrl,
        imageWidth: picture.width,
        imageHeight: picture.height,
        aspect: picture.aspect,
        renderRegion: (picture as { renderRegion?: never }).renderRegion,
        building,
        floor,
        onProgress: setStatus
      });
      persist(imported, false);
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
        rules={rules} initialAiRooms={studioSeeds} initialNotice={studioNotice}
        onShipped={(rooms, setSaved) => {
          setStudioPic(null);
          setResult({ rooms, printed: rooms, scaled: true, calibrated: true });
          if (!setSaved) setStatus("Note: the editable calibration set could not be saved (storage full) — the floor plan itself is in.");
          setPhase("done");
        }}
        onCancel={() => setStudioPic(null)} />
    );
  }

  return (
    <>
      {(
        <div className="pro-modalback" onClick={(e) => {
          if (e.target === e.currentTarget && phase !== "working") close();
        }}>
          <div className="pro-modal aiplan">
            <div className="pshead">
              <h2>🗺 Upload a floor plan</h2>
              {phase !== "working" && <button className="pbtn ghost" onClick={close}>✕</button>}
            </div>

            {(phase === "form" || phase === "error") && step === "choice" && (
              <>
                <p className="pnote">
                  One question first: does the file state its measurements — room sizes or
                  square footage readable on the plan (or in the CAD data)?
                </p>
                <button className="upltile" onClick={() => { setMode("read"); setStep("form"); }}>
                  <b>✨ Yes — the sizes are in the file</b>
                  <span>
                    Max reads the rooms, numbers and square footage, and the plan arrives already
                    to scale. Nothing to measure.
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
                  {mode === "calibrate"
                    ? "Pick the file — picture, PDF, or CAD (DXF). Max draws the rooms first; the Calibration Editor opens with them ready to correct."
                    : "Pick the file — picture, PDF, or CAD (DXF). Max reads the rooms, their numbers and the stated square footage, then OpsMatrix redraws the plan in its own style."}
                </p>

                {/* the hierarchy, up front: account → building → floor.
                    Departments are picked per room later, in the editor. */}
                <div className="prow">
                  <label className="pfield">Account <small>your hospital system</small>
                    <input value={account} placeholder="e.g. Summa Health"
                      onChange={(e) => setAccount(e.target.value)} />
                  </label>
                  <label className="pfield">Building
                    <input value={building} placeholder="e.g. Crawfordsville"
                      onChange={(e) => setBuilding(e.target.value)} />
                  </label>
                  <label className="pfield">Floor
                    <input value={floor} placeholder="e.g. 2nd Floor"
                      onChange={(e) => setFloor(e.target.value)} />
                  </label>
                </div>

                {proxied ? (
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
                  onClick={() => fileRef.current?.click()}>
                  {mode === "calibrate" ? "Choose the file — open the Calibration Editor" : "Choose floor plan (image, PDF or DXF)"}
                </button>
                {(!account.trim() || !building.trim() || !floor.trim()) &&
                  <small className="pnote">Fill in account, building and floor first — that's where this plan files itself.</small>}
                {!(!account.trim() || !building.trim() || !floor.trim()) && mode === "read" && !keySaved && !proxied &&
                  <small className="pnote">Save the API key above first — one time only.</small>}
                <p className="pnote">
                  <button className="plink" onClick={() => setStep("choice")}>‹ Back to the question</button>
                </p>

                <input ref={fileRef} type="file" style={{ display: "none" }}
                  accept="image/*,application/pdf,.pdf,.dxf,.dwg"
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
                <p className="pnote">
                  {result.calibrated
                    ? "Shipped to Max Space — drawn in OpsMatrix's own style, every room measured from your calibration and filed under " + [account, building, floor].filter(Boolean).join(" → ") + ". The set stays editable in Max Space → Calibration Editor."
                    : (result.printed > 0
                      ? `${result.printed} of them had a square footage stated in the file, so those areas were used as-is`
                      : "No square footage was stated in the file, so the rooms were measured from the drawing") +
                    (result.scaled
                      ? " — the plan is already to scale, so there is nothing to measure by hand."
                      : ". Set the scale once on the plan if you want exact areas.")}
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
    </>
  );
}
