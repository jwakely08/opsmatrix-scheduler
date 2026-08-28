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
import { importPlanFromImage, AiPlanError, type ImportResult } from "../bridge/aiPlanImport";
import { attachPlanToRooms } from "./roomListImport";
import { planFileToImage, isPdf } from "./planFile";
import { dxfToPicture, isDxf, isDwg } from "./dxfRaster";
import { loadApiKey, saveApiKey } from "./classicStore";
import { aiProxy } from "./aiTransport";
import { PlanStudio, type StudioPicture } from "./PlanStudio";
import type { ClassicData } from "./classicStore";

type Phase = "form" | "working" | "done" | "error";
type ReadMode = "read" | "calibrate";

export function AiPlanImport({ commit, onImported, open, onClose, defaultMode }: {
  commit: (mut: (d: ClassicData) => void) => void;
  onImported: () => void;
  open: boolean;
  onClose: () => void;
  /** open straight into one mode (e.g. classic's "no sizes" tile) */
  defaultMode?: ReadMode;
}) {
  const [phase, setPhase] = useState<Phase>("form");
  const [step, setStep] = useState<"choice" | "form">(defaultMode ? "form" : "choice");
  const [mode, setMode] = useState<ReadMode>(defaultMode ?? "read");
  const [studioPic, setStudioPic] = useState<StudioPicture | null>(null);
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

  /** write an imported plan into the stores (shared by both modes) */
  function persist(imported: ImportResult, calibrated: boolean) {
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
        // NO reading yet — the Studio opens on the picture, the manager
        // calibrates first, and Max runs only when they ask it to
        setPhase("form");
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

  // the Studio is full-screen and owns the whole calibrate experience
  if (studioPic) {
    return (
      <PlanStudio picture={studioPic} building={building} floor={floor}
        onDone={(r) => persist(r, true)}
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
                    The Plan Studio opens on your file: trace a room you KNOW (the snap pulls it
                    onto the walls), type its square footage — that's the calibration — then Max
                    draws the rest, measured from YOUR numbers. Adjust any shape before it becomes
                    the floor plan.
                  </span>
                </button>
              </>
            )}

            {(phase === "form" || phase === "error") && step === "form" && (
              <>
                <p className="pnote">
                  {mode === "calibrate"
                    ? "Pick the file — picture, PDF, or CAD (DXF). It opens in the Plan Studio, where you calibrate before anything is read."
                    : "Pick the file — picture, PDF, or CAD (DXF). Max reads the rooms, their numbers and the stated square footage, then OpsMatrix redraws the plan in its own style."}
                </p>

                <div className="prow">
                  <label className="pfield">Building <small>optional</small>
                    <input value={building} placeholder="read from the plan if left blank"
                      onChange={(e) => setBuilding(e.target.value)} />
                  </label>
                  <label className="pfield">Floor <small>optional</small>
                    <input value={floor} placeholder="e.g. 4 East"
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
                  disabled={mode === "read" && !keySaved && !proxied}
                  onClick={() => fileRef.current?.click()}>
                  {mode === "calibrate" ? "Choose the file — open the Plan Studio" : "Choose floor plan (image, PDF or DXF)"}
                </button>
                {mode === "read" && !keySaved && !proxied &&
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
                    ? "Drawn in OpsMatrix's own style, every room measured from your calibration. It's saved with your other floor plans."
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
