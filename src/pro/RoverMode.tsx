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
//   • Saving: every ✓ Confirm commits immediately — and so does every way out of
//     a room (Josh, 2026-10-28: "I hit save and exit and nothing happens"):
//     tapping the next room, ✕, tapping the plan, another floor, Save & Exit,
//     the iPad locking or switching apps. Only "cancel" throws the changes away.
//   • 📍 My location drops a YOU pin where you tap. Automatic dead-reckoning
//     was deliberately dropped: phone motion sensors drift metres in the
//     first corridor, and a dot that lies is worse than no dot.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyRoomType, applyFloorType, spaceIncomplete, syncSpaceMinutes, FLOOR_TYPES,
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
  // the rooms as saved, for the voice's numbers and for saving only what changed
  const spacesRef = useRef(spaces);
  spacesRef.current = spaces;
  // a name was already said for the open room: a stray word can't replace it
  const nameSpokenRef = useRef(false);
  // the fields the walker typed or said in the open room — what leaving it saves
  const touchedRef = useRef(new Set<keyof RoverDraft>());
  const lastSavedRef = useRef("");
  /** a typed change: the card shows it, and leaving the room saves it */
  const edit = (patch: RoverDraft) => {
    for (const k of Object.keys(patch) as (keyof RoverDraft)[]) touchedRef.current.add(k);
    setDraft((prev) => ({ ...prev, ...patch }));
  };
  // department is STICKY across the walk (Josh, 2026-09-13): a walker
  // validates a wing at a time — say "department imaging" once and every
  // room after carries it until a different department is spoken or typed
  const lastDeptRef = useRef<string>("");
  const deptOptions = [...new Set(spaces
    .map((s) => String(s.department ?? "").trim()).filter(Boolean))].sort();
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

  /**
   * Save what the open room's card holds — only when it differs from the room as saved. Every
   * way out of a room comes through here; `force` marks the room validated even unchanged
   * (✓ Confirm: "it's right as it is").
   */
  const saveOpen = useCallback((force = false): boolean => {
    const id = selRef.current;
    if (!id) return false;
    // leaving a room saves what the walker typed or said there; ✓ Confirm saves the whole card
    // (the sticky department rides only on a confirm, never on a room tapped just to look)
    const full = draftRef.current;
    const d: RoverDraft = force ? full : {};
    if (!force) for (const k of touchedRef.current) (d as Record<string, unknown>)[k] = full[k];
    const was = spacesRef.current.find((s) => s.id === id);
    if (!was) return false;
    const stamp = JSON.stringify([id, d]);
    if (!force && stamp === lastSavedRef.current) return false; // already saved, just now
    const same = (a: unknown, b: unknown) => String(a ?? "").trim() === String(b ?? "").trim();
    const typeOf = (label: unknown) => typeIdFromLabelStrict(rules, String(label ?? "")) ?? String(label ?? "").trim();
    const changed =
      (d.roomNumber !== undefined && !same(d.roomNumber, was.roomNumber)) ||
      (d.roomName !== undefined && !same(d.roomName, was.roomName)) ||
      (d.floorType !== undefined && !same(d.floorType, was.floorType)) ||
      (d.fixtureCount !== undefined && Number(d.fixtureCount) !== (Number(was.fixtureCount) || 0)) ||
      (d.department !== undefined && !same(d.department, was.department)) ||
      (d.roomType !== undefined && typeOf(d.roomType) !== typeOf(was.roomType));
    if (!changed && !force) return false;
    if (changed) {
      commit((data) => {
        const sp = (data.v7.spaces ?? []).find((s) => s.id === id);
        if (!sp) return;
        if (d.roomNumber !== undefined) sp.roomNumber = d.roomNumber;
        if (d.roomName !== undefined) sp.roomName = d.roomName;
        // floor before type, so a re-typed room gets the NEW floor's tasks
        if (d.floorType !== undefined) applyFloorType(sp, d.floorType, rules);
        if (d.fixtureCount !== undefined) sp.fixtureCount = d.fixtureCount;
        if (d.department !== undefined) sp.department = d.department;
        if (d.roomType !== undefined && typeOf(d.roomType) !== typeOf(sp.roomType)) {
          const tid = typeIdFromLabelStrict(rules, d.roomType);
          if (tid) applyRoomType(sp, tid, rules); // label + auto tasks + minutes
          else sp.roomType = d.roomType;
        }
        syncSpaceMinutes(sp, rules);
      });
      lastSavedRef.current = stamp;
    }
    if (d.department) lastDeptRef.current = d.department; // carries to the next rooms
    setConfirmedIds((prev) => new Set(prev).add(id));
    setFlash("✓ Saved " + (d.roomNumber || was.roomNumber || ""));
    setTimeout(() => setFlash(""), 1400);
    return true;
  }, [commit, rules]);

  /** close the open room's card — saving it, unless the walker said "cancel" */
  const closeRoom = useCallback((save = true) => {
    if (save) saveOpen();
    setSelId(null);
    setDraft({});
    setHeard("");
  }, [saveOpen]);

  const confirmRoom = useCallback(() => {
    saveOpen(true);
    closeRoom(false);
  }, [saveOpen, closeRoom]);

  // the iPad locking, or switching to another app, never loses the open room
  const saveRef = useRef(saveOpen);
  saveRef.current = saveOpen;
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") saveRef.current(); };
    const onPageHide = () => saveRef.current();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      saveRef.current(); // leaving Rover any other way saves too
    };
  }, []);

  const confirmRef = useRef(confirmRoom);
  confirmRef.current = confirmRoom;
  const closeRef = useRef(closeRoom);
  closeRef.current = closeRoom;

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
          // the open room's own number and this floor's: "297" and "F V 4 297" mean FV4-297
          const open = spacesRef.current.find((s) => s.id === selRef.current);
          const { draft: heard, command, nameLabeled } = parseRoverUtterance(text, rules, {
            currentNumber: String(open?.roomNumber ?? ""),
            floorNumbers: spacesRef.current.map((s) => String(s.roomNumber ?? "")).filter(Boolean)
          });
          const keepName = nameSpokenRef.current;
          setDraft((prev) => mergeDraft(prev, heard, { keepName, nameLabeled }));
          const nameTaken = heard.roomName !== undefined &&
            (nameLabeled || !keepName || heard.roomName.trim().split(/\s+/).length >= 2);
          if (nameTaken) nameSpokenRef.current = true;
          for (const k of Object.keys(heard) as (keyof RoverDraft)[]) {
            if (k !== "roomName" || nameTaken) touchedRef.current.add(k);
          }
          if (command === "confirm") confirmRef.current();
          else if (command === "clear") setDraft({});
          else if (command === "cancel") closeRef.current(false);
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
    nameSpokenRef.current = false;
    touchedRef.current = new Set();
    setSelId(sp.id);
    // start from what the room already knows — speak only what changes
    setDraft({
      roomNumber: String(sp.roomNumber ?? "") || undefined,
      roomName: String(sp.roomName ?? "") || undefined,
      roomType: String(sp.roomType ?? "") || undefined,
      floorType: String(sp.floorType ?? "") || undefined,
      fixtureCount: Number(sp.fixtureCount) || undefined,
      // the room's own department wins; otherwise this walk's sticky one
      department: String(sp.department ?? "") || lastDeptRef.current || undefined
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
        <button className="pbtn primary" onClick={() => { saveOpen(); onExit(); }}>✓ Save &amp; Exit</button>
      </header>

      <div className="rover-map">
        <MapCanvas
          plan={plan} plans={plans}
          onPlan={(id) => { closeRoom(); onPlan(id); }}
          badge={<BuildingBadge building={building} />}
          spaces={spaces} shapes={shapes}
          mode="rover"
          // the zoom is the walker's: opening a room's card never refits the floor, and the
          // room just tapped slides into view above the card
          keepView follow={selId}
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
            if (sp && sp.id === selRef.current) return; // the open room, tapped again
            // the room being left is saved first, then the next one opens
            if (!sp) { closeRoom(); return; }
            saveOpen();
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
            <button className="pbtn ghost" aria-label="Save and close this room" onClick={() => closeRoom()}>✕</button>
          </div>
          <div className="rover-fields">
            <label>Room number
              <input value={draft.roomNumber ?? ""} placeholder="e.g. 102"
                onChange={(e) => edit({ roomNumber: e.target.value })} />
            </label>
            <label>Room name
              <input value={draft.roomName ?? ""} placeholder="e.g. Dr Smith's Office"
                onChange={(e) => edit({ roomName: e.target.value })} />
            </label>
            <label>Room type
              <select value={typeId ?? ""} onChange={(e) => {
                const rt = rules.roomTypes.find((x) => x.id === e.target.value);
                edit({ roomType: rt?.label });
              }}>
                <option value="">{draft.roomType ? draft.roomType + " (?)" : "— say or pick —"}</option>
                {rules.roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
              </select>
            </label>
            <label>Floor type
              <select value={draft.floorType ?? ""}
                onChange={(e) => edit({ floorType: e.target.value })}>
                <option value="">— say or pick —</option>
                {FLOOR_TYPES.map((f) => <option key={f}>{f}</option>)}
              </select>
            </label>
            <label>Fixtures
              <input type="number" min={0} value={draft.fixtureCount ?? ""}
                placeholder="0"
                onChange={(e) => edit({ fixtureCount: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </label>
            <label>Department
              <input list="rover-depts" value={draft.department ?? ""}
                placeholder='say "department imaging"'
                onChange={(e) => edit({ department: e.target.value || undefined })} />
              <datalist id="rover-depts">
                {deptOptions.map((d) => <option key={d} value={d} />)}
              </datalist>
            </label>
          </div>
          <button className="pbtn primary rover-confirm" onClick={confirmRoom}>
            ✓ Confirm — save this room
          </button>
          <small className="rover-say">Say it plainly: “102, office, Dr Smith's office, carpet, zero fixtures, department imaging”. Changes save when you tap the next room, ✕, or Save &amp; Exit — say “cancel” to throw them away. The department sticks for every room after, until you say a new one.</small>
        </div>
      )}
    </div>,
    document.body
  );
}
