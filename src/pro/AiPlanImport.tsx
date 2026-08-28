// "Read a floor plan with Max" — pick a picture or PDF of any floor plan and
// let Claude Fable 5 turn it into a real OpsMatrix plan: rooms traced, room
// numbers and printed areas captured, and the whole thing redrawn in the app's
// own style so it looks like every other plan in the system.
import React, { useEffect, useRef, useState } from "react";
import { importPlanFromImage, AiPlanError } from "../bridge/aiPlanImport";
import { attachPlanToRooms } from "./roomListImport";
import { planFileToImage, isPdf } from "./planFile";
import { loadApiKey, saveApiKey } from "./classicStore";
import { aiProxy } from "./aiTransport";
import { calibrateFromKnownRooms, pixelArea, type CalRoomLike } from "./planCalibrate";
import type { ClassicData } from "./classicStore";

type Phase = "form" | "working" | "calibrate" | "done" | "error";
type ReadMode = "read" | "calibrate";

interface PendingImport {
  spaces: CalRoomLike[];
  plan: Record<string, unknown>;
}

/**
 * Controlled modal — the ⬆ Upload hub owns the trigger. There is exactly one
 * way a floor plan comes into OpsMatrix: Max reads it. (Josh's order,
 * 2026-08-24: no manual "upload as a picture" path.)
 */
export function AiPlanImport({ commit, onImported, open, onClose, defaultMode }: {
  commit: (mut: (d: ClassicData) => void) => void;
  onImported: () => void;
  open: boolean;
  onClose: () => void;
  /** open straight into one mode (e.g. classic's "no sizes" tile) */
  defaultMode?: ReadMode;
}) {
  const [phase, setPhase] = useState<Phase>("form");
  // step 1 is an explicit question (Josh, 2026-08-28): sizes printed on the
  // plan → Max reads everything; no readable sizes → Max still reads and
  // draws the rooms, then 1–3 KNOWN rooms calibrate the whole plan
  const [step, setStep] = useState<"choice" | "form">(defaultMode ? "form" : "choice");
  const [mode, setMode] = useState<ReadMode>(defaultMode ?? "read");
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [anchors, setAnchors] = useState<Record<string, string>>({});
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [apiKey, setApiKey] = useState<string>(() => loadApiKey());
  const [keySaved, setKeySaved] = useState<boolean>(() => Boolean(loadApiKey()));
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ rooms: number; printed: number; scaled: boolean } | null>(null);
  // cloud accounts: AI reading is included — the server holds the key
  const [proxied, setProxied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void aiProxy().then((p) => setProxied(Boolean(p))); }, []);

  const close = () => {
    setPhase("form");
    setStep(defaultMode ? "form" : "choice");
    setMode(defaultMode ?? "read");
    setPending(null);
    setAnchors({});
    setError(""); setStatus(""); setResult(null);
    onClose();
  };

  /** write an imported plan into the stores (shared by both modes) */
  function persist(imported: PendingImport) {
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
      scaled: Boolean((imported.plan as { ratio?: number }).ratio)
    });
    setPhase("done");
  }

  async function handleFile(file: File) {
    setPhase("working");
    setError("");
    try {
      setStatus(isPdf(file) ? "Opening the PDF…" : "Opening the image…");
      const picture = await planFileToImage(file);

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
        renderRegion: picture.renderRegion,
        building,
        floor,
        onProgress: setStatus
      }) as unknown as PendingImport;

      if (mode === "calibrate") {
        // no readable sizes: Max has read and drawn the rooms — now the
        // manager anchors the scale with 1–3 rooms they know
        setPending(imported);
        setAnchors({});
        setPhase("calibrate");
        return;
      }
      persist(imported);
    } catch (e) {
      setError(e instanceof AiPlanError ? e.message : String((e as Error)?.message || e));
      setPhase("error");
    }
  }

  function applyCalibration() {
    if (!pending) return;
    const pairs = Object.entries(anchors)
      .map(([id, v]) => ({ id, sqft: Number(v) }))
      .filter((p) => p.sqft > 0);
    const cal = calibrateFromKnownRooms(pending.spaces, pairs);
    if (!cal) {
      setError("Enter the square footage of at least one room Max drew (a room you know).");
      return;
    }
    setError("");
    for (const sp of pending.spaces) {
      const sqft = cal.sqftById.get(sp.id);
      if (sqft !== undefined) sp.squareFeet = sqft;
    }
    (pending.plan as { ratio?: number }).ratio = cal.pxPerFt;
    persist(pending);
  }

  if (!open) return null;

  return (
    <>
      {(
        <div className="pro-modalback" onClick={(e) => {
          if (e.target === e.currentTarget && phase !== "working") close();
        }}>
          <div className="pro-modal aiplan">
            <div className="pshead">
              <h2>✨ Read a floor plan with Max</h2>
              {phase !== "working" && <button className="pbtn ghost" onClick={close}>✕</button>}
            </div>

            {(phase === "form" || phase === "error") && step === "choice" && (
              <>
                <p className="pnote">
                  One question first: does the plan have readable measurements — room sizes or
                  square footage printed on it?
                </p>
                <button className="upltile" onClick={() => { setMode("read"); setStep("form"); }}>
                  <b>✨ Yes — the sizes are printed on the plan</b>
                  <span>
                    Max reads the rooms, numbers and square footage, and the plan arrives already
                    to scale. Nothing to measure.
                  </span>
                </button>
                <button className="upltile" onClick={() => { setMode("calibrate"); setStep("form"); }}>
                  <b>📐 No — it's just the floor plan, no sizes</b>
                  <span>
                    Max still reads and draws every room. Then you type the square footage of
                    1–3 rooms you KNOW, and every other room is measured from your calibration —
                    the plan comes out in OpsMatrix's own style like any other import.
                  </span>
                </button>
                <p className="pnote">
                  Worst-case plan (too blurry for Max)?{" "}
                  <a className="plink" href="./classic.html?calibrate=1">Trace it by hand in the plan editor →</a>
                </p>
              </>
            )}

            {(phase === "form" || phase === "error") && step === "form" && (
              <>
                <p className="pnote">
                  {mode === "calibrate"
                    ? "Pick the picture or PDF. Max reads and draws every room; on the next step you type the square footage of 1–3 rooms you know, and the rest are measured from your calibration."
                    : "Pick a picture or PDF of any floor plan. Max reads the rooms, their numbers and any square footage printed on it, then OpsMatrix redraws the plan in its own style — colours, furniture and title blocks from the original are ignored."}
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
                  <label className="pfield">Anthropic API key
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

                <button className="pbtn primary wide" disabled={!keySaved && !proxied}
                  onClick={() => fileRef.current?.click()}>
                  Choose floor plan (image or PDF)
                </button>
                {!keySaved && !proxied && <small className="pnote">Save the API key above first — one time only.</small>}
                <p className="pnote">
                  <button className="plink" onClick={() => setStep("choice")}>‹ No sizes on the plan after all? Go back</button>
                </p>

                <input ref={fileRef} type="file" style={{ display: "none" }}
                  accept="image/*,application/pdf,.pdf"
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

            {phase === "calibrate" && pending && (
              <>
                <p className="pnote big">✓ Max read and drew {pending.spaces.length} rooms.</p>
                <p className="pnote">
                  Now the calibration: type the square footage of <b>1–3 rooms you KNOW</b>.
                  Two or three beats one. Every other room is measured from your numbers.
                </p>
                <div className="callist">
                  {[...pending.spaces]
                    .sort((a, b) => pixelArea(b.visualPts) - pixelArea(a.visualPts))
                    .map((sp) => (
                      <label key={sp.id} className="calrow">
                        <b>{String(sp.roomNumber ?? "") || String(sp.roomName ?? "") || "Room"}</b>
                        <span>{String(sp.roomName ?? "")}</span>
                        <input type="number" min={1} placeholder="sq ft"
                          value={anchors[sp.id] ?? ""}
                          onChange={(e) => setAnchors({ ...anchors, [sp.id]: e.target.value })} />
                      </label>
                    ))}
                </div>
                {error && <p className="warntext">⚠ {error}</p>}
                <button className="pbtn primary wide"
                  disabled={!Object.values(anchors).some((v) => Number(v) > 0)}
                  onClick={applyCalibration}>
                  ✓ Apply calibration — create the floor plan
                </button>
                <p className="pnote">
                  Shapes look wrong? <a className="plink" href="./classic.html?calibrate=1">Trace the plan by hand instead →</a>
                </p>
              </>
            )}

            {phase === "done" && result && (
              <>
                <p className="pnote big">✓ {result.rooms} rooms read and drawn.</p>
                <p className="pnote">
                  {mode === "calibrate"
                    ? "Your calibration set the scale — every room's square footage was measured from the drawing, and the plan is drawn in OpsMatrix's own style like any other import."
                    : (result.printed > 0
                      ? `${result.printed} of them had a square footage printed on the plan, so those areas were used as-is`
                      : "No square footage was printed on the plan, so the rooms were measured from the drawing") +
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
