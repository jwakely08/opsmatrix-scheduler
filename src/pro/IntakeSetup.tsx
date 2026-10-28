// Scope → "Set up Scope from an intake form" (Josh, 2026-10-28): choose the intake a facility filled
// in and sent back, review every change it makes (intakeScope.ts), set Scope up in one step — and
// undo it right after if it wasn't what you wanted. The facility profile the intake leaves behind
// shows below it for building schedules.
import React, { useRef, useState } from "react";
import type { Rules } from "./rules";
import { IntakeError, intakeToScope, readIntake, type IntakeProfile, type IntakeResult } from "./intakeScope";

export function IntakeSetup({ rules, onApply }: { rules: Rules; onApply: (next: Rules) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<IntakeResult | null>(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ prev: Rules; facility: string } | null>(null);

  const read = async (file: File) => {
    setErr("");
    try {
      setReview(intakeToScope(rules, readIntake(await file.text())));
    } catch (e) {
      setReview(null);
      setErr(e instanceof IntakeError ? e.message : "This file couldn't be read.");
    }
  };

  const profile = review?.rules.intake;
  return (
    <div className="gccard intakecard">
      <div className="gchead"><b>📋 Set up Scope from an intake form</b></div>
      {!review && (<>
        <p className="pnote">
          Choose the intake form a facility filled in and sent back (the .html file). OpsMatrix reads their
          answers and shows every change before anything is saved. Cleaning rates are the industry standard
          per square foot (ISSA 612).
        </p>
        <div className="prow">
          <button className="pbtn primary" onClick={() => fileRef.current?.click()}>Choose the intake form…</button>
        </div>
      </>)}
      {err && <p className="warntext">⚠ {err}</p>}
      {review && (
        <div className="intakereview">
          <p>
            <b>{profile?.facility}</b>{profile?.completed ? ` — intake completed ${profile.completed}` : ""}.
            {" "}This is what changes in Scope:
          </p>
          {review.changes.map((c) => (
            <details key={c.title} open={c.lines.length <= 4}>
              <summary>{c.title}</summary>
              <ul>{c.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </details>
          ))}
          {review.notUsed.length > 0 && (
            <details>
              <summary>Not used from the form ({review.notUsed.length})</summary>
              <ul>{review.notUsed.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </details>
          )}
          <p className="pnote">Every room's minutes are worked out again with the new Scope. Unsaved edits below are replaced.</p>
          <div className="prow">
            <button className="pbtn primary" onClick={() => {
              setDone({ prev: rules, facility: profile?.facility ?? "the facility" });
              onApply(review.rules);
              setReview(null);
            }}>✓ Set up Scope</button>
            <button className="pbtn" onClick={() => setReview(null)}>Cancel</button>
          </div>
        </div>
      )}
      {done && !review && (
        <p className="pnote keysaved">
          ✓ Scope is set up from {done.facility}'s intake, and every room's time is recalculated.{" "}
          <button className="plink" onClick={() => { onApply(done.prev); setDone(null); }}>↶ Undo</button>
        </p>
      )}
      {/* no file-type filter: an iPad greys out files a filter doesn't name */}
      <input ref={fileRef} type="file" style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void read(f);
        }} />
    </div>
  );
}

/** what the intake told us that isn't a Scope setting — shifts, volumes, staffing, services */
export function IntakeProfileCard({ profile }: { profile: IntakeProfile }) {
  const block = (title: string, lines: string[]) => (lines.length ? (
    <div className="intakeblock" key={title}>
      <b>{title}</b>
      <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  ) : null);
  return (
    <details className="gccard intakeprofile">
      <summary>
        From the intake: <b>{profile.facility}</b>{profile.system ? ` (${profile.system})` : ""}
        {profile.completed ? ` · completed ${profile.completed}` : ""}
      </summary>
      {profile.facts.length > 0 && (
        <div className="intakefacts">
          {profile.facts.map(([k, v]) => <span key={k}><i>{k}</i><b>{v}</b></span>)}
        </div>
      )}
      <div className="intakeblocks">
        {block("Shifts", profile.shifts)}
        {block("Discharges", profile.discharges)}
        {block("Staffing", profile.staffing)}
        {block("EVS handles", profile.services.handles)}
        {block("EVS handles in part", profile.services.partly)}
        {block("Between-case cleaning by EVS", profile.betweenCases)}
        {block("Cleaned by other departments", profile.otherDepartments)}
        {block("Curtains", profile.curtains)}
        {block("Floor care program", profile.floorCare)}
        {block("Floor types", profile.floorTypes)}
        {block("Extra tasks (outside the general clean)", profile.extraTasks)}
      </div>
    </details>
  );
}
