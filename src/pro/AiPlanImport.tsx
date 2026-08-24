// "Read a floor plan with Max" — pick a picture or PDF of any floor plan and
// let Claude Fable 5 turn it into a real OpsMatrix plan: rooms traced, room
// numbers and printed areas captured, and the whole thing redrawn in the app's
// own style so it looks like every other plan in the system.
import React, { useRef, useState } from "react";
import { importPlanFromImage, AiPlanError } from "../bridge/aiPlanImport";
import { attachPlanToRooms } from "./roomListImport";
import { planFileToImage, isPdf } from "./planFile";
import { loadApiKey, saveApiKey } from "./classicStore";
import type { ClassicData } from "./classicStore";

type Phase = "form" | "working" | "done" | "error";

/**
 * Controlled modal — the ⬆ Upload hub owns the trigger. There is exactly one
 * way a floor plan comes into OpsMatrix: Max reads it. (Josh's order,
 * 2026-08-24: no manual "upload as a picture" path.)
 */
export function AiPlanImport({ commit, onImported, open, onClose }: {
  commit: (mut: (d: ClassicData) => void) => void;
  onImported: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("form");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [apiKey, setApiKey] = useState<string>(() => loadApiKey());
  const [keySaved, setKeySaved] = useState<boolean>(() => Boolean(loadApiKey()));
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ rooms: number; printed: number; scaled: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const close = () => { setPhase("form"); setError(""); setStatus(""); setResult(null); onClose(); };

  async function handleFile(file: File) {
    setPhase("working");
    setError("");
    try {
      setStatus(isPdf(file) ? "Opening the PDF…" : "Opening the image…");
      const picture = await planFileToImage(file);

      const key = apiKey.trim();
      if (key && key !== loadApiKey()) saveApiKey(key);

      const imported = await importPlanFromImage({
        apiKey: key,
        imageDataUrl: picture.dataUrl,
        imageWidth: picture.width,
        imageHeight: picture.height,
        aspect: picture.aspect,
        renderRegion: picture.renderRegion,
        building,
        floor,
        onProgress: setStatus
      });

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
    } catch (e) {
      setError(e instanceof AiPlanError ? e.message : String((e as Error)?.message || e));
      setPhase("error");
    }
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

            {(phase === "form" || phase === "error") && (
              <>
                <p className="pnote">
                  Pick a picture or PDF of any floor plan. Max reads the rooms, their numbers and
                  any square footage printed on it, then OpsMatrix redraws the plan in its own
                  style — colours, furniture and title blocks from the original are ignored.
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

                {keySaved ? (
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

                <button className="pbtn primary wide" disabled={!keySaved}
                  onClick={() => fileRef.current?.click()}>
                  Choose floor plan (image or PDF)
                </button>
                {!keySaved && <small className="pnote">Save the API key above first — one time only.</small>}

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

            {phase === "done" && result && (
              <>
                <p className="pnote big">✓ {result.rooms} rooms read and drawn.</p>
                <p className="pnote">
                  {result.printed > 0
                    ? `${result.printed} of them had a square footage printed on the plan, so those areas were used as-is`
                    : "No square footage was printed on the plan, so the rooms were measured from the drawing"}
                  {result.scaled
                    ? " — the plan is already to scale, so there is nothing to measure by hand."
                    : ". Set the scale once on the plan if you want exact areas."}
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
