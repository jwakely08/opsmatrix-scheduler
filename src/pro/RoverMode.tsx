// ROVER MODE (Josh's final launch feature, 2026-09-01): full-screen,
// voice-first space validation for walking the hospital with an iPad or
// iPhone. Tap a room on the matrix → the mic opens → speak the data points
// plainly ("102 office Dr. Smith's office carpet zero fixtures") → the card
// fills instantly → say "confirm" (or thumb the big button) → the room SAVES
// on the spot → tap the next room.
//
// Speed decisions (Josh: "seamless and quick, no loading"):
//   • Speech: the device's OWN recognizer (Web Speech API) — on-device,
//     streaming, free, works in dead zones. iOS Safari stops listening after
//     each pause, so we transparently restart while a room is open.
//   • Parsing: roverParse.ts — a local grammar over Scope's own vocabulary.
//     Zero network per room; the fields fill the moment a sentence lands.
//   • Saving: every ✓ Confirm commits immediately. Save & Exit just leaves —
//     a dead battery in the east wing loses nothing.
//   • 📍 My location drops a YOU pin where you tap. Automatic dead-reckoning
//     was deliberately dropped: phone motion sensors drift metres in the
//     first corridor, and a dot that lies is worse than no dot.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyRoomType, spaceIncomplete, syncSpaceMinutes, FLOOR_TYPES,
  type ClassicData, type ClassicPlan, type ClassicSpace
} from "./classicStore";
import { typeIdFromLabelStrict, type Rules } from "./rules";
import { MapCanvas, BuildingBadge } from "./MapCanvas";
import { parseRoverUtterance, mergeDraft, type RoverDraft } from "./roverParse";

type Shapes = Map<string, { pts: { x: number; y: number }[]; path: string; c: { x: number; y: number } }>;

// the browser's own recognizer, if this device has one
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
}
function getRecognizer(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

export function RoverMode({ plan, plans, onPlan, spaces, shapes, rules, commit, building, onExit }: {
  plan: ClassicPlan;
  plans: ClassicPlan[];
  onPlan: (id: string) => void;
  spaces: ClassicSpace[];
  shapes: Shapes;
  rules: Rules;
  commit: (mut: (d: ClassicData) => void) => void;
  building: string;
  onExit: () => void;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoverDraft>({});
  const [heard, setHeard] = useState("");           // live interim transcript
  const [micState, setMicState] = useState<"idle" | "listening" | "denied" | "unsupported">("idle");
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [placingMe, setPlacingMe] = useState(false);
  const [mePin, setMePin] = useState<{ x: number; y: number } | null>(null);
  const [flash, setFlash] = useState("");

  const selected = spaces.find((s) => s.id === selId) ?? null;
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantMic = useRef(false);
  // the confirm path reads these from voice callbacks — refs keep them live
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const selRef = useRef<string | null>(null);
  selRef.current = selId;

  // ── native fullscreen where it exists (Android/desktop; iOS uses our
  // fixed overlay, which is the real fullscreen there) ─────────────────────
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => { /* iOS — overlay is enough */ });
    return () => { document.exitFullscreen?.().catch(() => { /* not fullscreen */ }); };
  }, []);

  const confirmRoom = useCallback(() => {
    const id = selRef.current;
    const d = draftRef.current;
    if (!id) return;
    commit((data) => {
      const sp = (data.v7.spaces ?? []).find((s) => s.id === id);
      if (!sp) return;
      if (d.roomNumber !== undefined) sp.roomNumber = d.roomNumber;
      if (d.roomName !== undefined) sp.roomName = d.roomName;
      if (d.floorType !== undefined) sp.floorType = d.floorType;
      if (d.fixtureCount !== undefined) sp.fixtureCount = d.fixtureCount;
      if (d.roomType !== undefined) {
        const tid = typeIdFromLabelStrict(rules, d.roomType);
        if (tid) applyRoomType(sp, tid, rules); // label + auto tasks + minutes
        else sp.roomType = d.roomType;
      }
      syncSpaceMinutes(sp, rules);
    });
    setConfirmedIds((prev) => new Set(prev).add(id));
    setFlash("✓ Saved " + (d.roomNumber || selected?.roomNumber || ""));
    setTimeout(() => setFlash(""), 1400);
    setSelId(null);
    setDraft({});
    setHeard("");
  }, [commit, rules, selected]);

  const confirmRef = useRef(confirmRoom);
  confirmRef.current = confirmRoom;

  // ── the mic: open while a room is open, restart through iOS's pauses ─────
  useEffect(() => {
    const RC = getRecognizer();
    if (!RC) { setMicState("unsupported"); return; }
    if (!selected) {
      wantMic.current = false;
      recRef.current?.stop();
      setMicState("idle");
      setHeard("");
      return;
    }
    wantMic.current = true;
    const rec = new RC();
    recRef.current = rec;
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript;
        if (r.isFinal) {
          const { draft: heard, command } = parseRoverUtterance(text, rules);
          setDraft((prev) => mergeDraft(prev, heard));
          if (command === "confirm") confirmRef.current();
          else if (command === "clear") setDraft({});
          else if (command === "cancel") { setSelId(null); setDraft({}); }
        } else {
          interim += text;
        }
      }
      setHeard(interim);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantMic.current = false;
        setMicState("denied");
      }
    };
    // iOS Safari ends recognition after every pause — quietly begin again
    rec.onend = () => {
      if (wantMic.current) {
        try { rec.start(); setMicState("listening"); } catch { /* mid-restart */ }
      }
    };
    try { rec.start(); setMicState("listening"); } catch { /* already started */ }
    return () => {
      wantMic.current = false;
      rec.onend = null;
      try { rec.stop(); } catch { /* already stopped */ }
    };
    // a NEW recognizer per selected room keeps iOS sessions short and stable
  }, [selected?.id, rules]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRoom = (sp: ClassicSpace) => {
    setSelId(sp.id);
    // start from what the room already knows — speak only what changes
    setDraft({
      roomNumber: String(sp.roomNumber ?? "") || undefined,
      roomName: String(sp.roomName ?? "") || undefined,
      roomType: String(sp.roomType ?? "") || undefined,
      floorType: String(sp.floorType ?? "") || undefined,
      fixtureCount: Number(sp.fixtureCount) || undefined
    });
    setHeard("");
  };

  const typeId = draft.roomType ? typeIdFromLabelStrict(rules, draft.roomType) : null;

  return createPortal(
    <div className="rover">
      <header className="rover-head">
        <b className="rover-brand">🚙 Rover <span>Mode</span></b>
        <span className={"rover-mic " + micState}>
          {micState === "listening" ? "● LISTENING" :
            micState === "denied" ? "MIC BLOCKED — allow the microphone in your browser settings" :
              micState === "unsupported" ? "VOICE NEEDS SAFARI/CHROME — typing still works" :
                "TAP A ROOM TO START"}
        </span>
        <span className="grow" />
        <button className={"pbtn small" + (placingMe ? " on" : "")}
          onClick={() => setPlacingMe(!placingMe)}>📍 My location</button>
        <button className="pbtn primary" onClick={onExit}>✓ Save &amp; Exit</button>
      </header>

      <div className="rover-map">
        <MapCanvas
          plan={plan} plans={plans} onPlan={onPlan}
          badge={<BuildingBadge building={building} />}
          spaces={spaces} shapes={shapes}
          mode="rover"
          marker={mePin ? { x: mePin.x, y: mePin.y, label: "YOU" } : null}
          onCanvas={placingMe ? (pt) => { setMePin(pt); setPlacingMe(false); } : undefined}
          fillFor={(sp) =>
            confirmedIds.has(sp.id) ? "#16a34a"
              : spaceIncomplete(sp).length ? "#b45309"
                : "#0d9488"}
          flagFor={(sp) => (!confirmedIds.has(sp.id) && spaceIncomplete(sp).length ? "⚠" : null)}
          selectedId={selId}
          onRoom={(sp) => {
            if (placingMe) return; // the location tap wins
            if (!sp) { setSelId(null); setDraft({}); return; }
            openRoom(sp);
          }}
          legend={
            <div className="pro-legend rover-legend">
              <span><i style={{ background: "#16a34a" }} />Validated this walk</span>
              <span><i style={{ background: "#0d9488" }} />Data complete</span>
              <span><i style={{ background: "#b45309" }} />Still needs details</span>
            </div>
          }
        />
        {placingMe && <div className="rover-hint">Tap the plan where you're standing</div>}
        {flash && <div className="rover-flash">{flash}</div>}
      </div>

      {selected && (
        <div className="rover-sheet">
          <div className="rover-sheethead">
            <b>{draft.roomNumber || selected.roomNumber || "Room"}</b>
            <span className="rover-heard">{heard || (micState === "listening" ? "speak the room's details…" : "")}</span>
            <button className="pbtn ghost" onClick={() => { setSelId(null); setDraft({}); }}>✕</button>
          </div>
          <div className="rover-fields">
            <label>Room number
              <input value={draft.roomNumber ?? ""} placeholder="e.g. 102"
                onChange={(e) => setDraft({ ...draft, roomNumber: e.target.value })} />
            </label>
            <label>Room name
              <input value={draft.roomName ?? ""} placeholder="e.g. Dr Smith's Office"
                onChange={(e) => setDraft({ ...draft, roomName: e.target.value })} />
            </label>
            <label>Room type
              <select value={typeId ?? ""} onChange={(e) => {
                const rt = rules.roomTypes.find((x) => x.id === e.target.value);
                setDraft({ ...draft, roomType: rt?.label });
              }}>
                <option value="">{draft.roomType ? draft.roomType + " (?)" : "— say or pick —"}</option>
                {rules.roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
              </select>
            </label>
            <label>Floor type
              <select value={draft.floorType ?? ""}
                onChange={(e) => setDraft({ ...draft, floorType: e.target.value })}>
                <option value="">— say or pick —</option>
                {FLOOR_TYPES.map((f) => <option key={f}>{f}</option>)}
              </select>
            </label>
            <label>Fixtures
              <input type="number" min={0} value={draft.fixtureCount ?? ""}
                placeholder="0"
                onChange={(e) => setDraft({ ...draft, fixtureCount: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </label>
          </div>
          <button className="pbtn primary rover-confirm" onClick={confirmRoom}>
            ✓ Confirm — save this room
          </button>
          <small className="rover-say">Say it plainly: “102, office, Dr Smith's office, carpet, zero fixtures” — then say “confirm”.</small>
        </div>
      )}
    </div>,
    document.body
  );
}
