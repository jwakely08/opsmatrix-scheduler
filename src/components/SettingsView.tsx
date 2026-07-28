import React, { useRef, useState } from "react";
import { useStore } from "../state/store";
import { useUI } from "../state/ui";
import { useAuth } from "../auth/AuthContext";
import { supabase } from "../auth/supabaseClient";
import { defaultState, qualifierPresets, nextColor, COLOR_PALETTE } from "../lib/seeds";
import { migrateState } from "../lib/migrate";
import { uid, FLOOR_FINISH_LABELS, FLOOR_FINISH_SHORT, type AppState, type FloorFinish, type RoomTypeTemplate } from "../lib/types";
import { download } from "../lib/format";
import { toast } from "./Toast";
import { Modal } from "./Modal";
import { log } from "../lib/logger";

function Section({ id, icon, title, blurb, children }: {
  id: string; icon: string; title: string; blurb: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"setsection" + (open ? " open" : "")}>
      <button className="sethead" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={"sec_" + id}>
        <span className="icon">{icon}</span>
        <span className="t"><b>{title}</b><span>{blurb}</span></span>
        <span className="caret2">▸</span>
      </button>
      {open && <div className="setbody" id={"sec_" + id}>{children}</div>}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  per1000: "min per 1,000 ft²",
  perFixture: "min per fixture",
  flatPerVisit: "min each visit",
  multiplier: "× the total"
};

export function SettingsView() {
  const { state, update, replaceState, reload } = useStore();
  const ui = useUI();
  const auth = useAuth();
  const restoreRef = useRef<HTMLInputElement>(null);
  const [pendingRestore, setPendingRestore] = useState<AppState | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [newType, setNewType] = useState(false);
  const [inviteRole, setInviteRole] = useState<"supervisor" | "staff">("staff");
  const [inviteCode, setInviteCode] = useState("");

  const canEdit = ui.canEditFacility;

  function handleRestoreFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(String(reader.result));
        if (!incoming || typeof incoming !== "object" || !incoming.version) {
          throw new Error("that file isn't an OpsMatrix backup");
        }
        setPendingRestore(migrateState(incoming));
      } catch (err: any) {
        toast("Couldn't read that backup: " + (err?.message ?? err), true);
      }
    };
    reader.readAsText(file);
  }

  async function makeInvite() {
    if (!supabase) return;
    const r = await supabase.rpc("create_invite", { invite_role: inviteRole });
    if (r.error) { log.warn("invite failed", r.error); toast(r.error.message, true); return; }
    setInviteCode(r.data as string);
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <h1 className="pagetitle">Settings</h1>
      <p className="pagesub">Everything here is optional — the starting numbers work fine. Open a section to adjust it.</p>

      {/* ============ Cleaning times ============ */}
      <Section id="times" icon="⏱️" title="Cleaning times"
        blurb="How long cleaning takes — starting numbers you can adjust.">
        <div className="bigrate">
          <span className="lbl">A plain, empty room takes about</span>
          <input type="number" min={1} step={1} value={state.rates.baseMinutesPer1000} disabled={!canEdit}
            onChange={(e) => update((d) => { d.rates.baseMinutesPer1000 = Number(e.target.value) || 15; })} />
          <span className="lbl"><b>minutes per 1,000 sq ft</b> to clean.</span>
        </div>
        <p className="note" style={{ marginBottom: 14 }}>
          Everything else adds to (or multiplies) that number. These are starting estimates from
          industry-standard cleaning data — adjust them to match your building.
        </p>

        <h4 style={{ marginBottom: 8 }}>The floor makes a difference</h4>
        <div className="tablewrap" style={{ marginBottom: 16 }}>
          <table className="grid">
            <tbody>
              {(Object.keys(FLOOR_FINISH_LABELS) as FloorFinish[]).map((f) => (
                <tr key={f}>
                  <td>{FLOOR_FINISH_LABELS[f]}</td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    +<input type="number" min={0} step={1} value={state.rates.floorFinishAdjust[f]} disabled={!canEdit}
                      onChange={(e) => update((d) => { d.rates.floorFinishAdjust[f] = Number(e.target.value) || 0; })} />
                    <span className="note"> min / 1,000 ft²</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 style={{ marginBottom: 8 }}>Room types</h4>
        <p className="note" style={{ marginBottom: 10 }}>
          Each room type adds its own extras — open "Fine-tune" on any type to see and change them in plain English.
          Rooms on a schedule automatically carry their type's task list.
        </p>
        {state.roomTypes.map((rt) => (
          <details className="finetune" key={rt.id}>
            <summary>{rt.name}</summary>
            <div style={{ padding: "8px 0 4px 14px" }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <div className="field"><label>Floor</label>
                  <select value={rt.floorFinish} disabled={!canEdit}
                    onChange={(e) => update((d) => {
                      const t = d.roomTypes.find((x) => x.id === rt.id);
                      if (t) t.floorFinish = e.target.value as FloorFinish;
                    })}>
                    {(Object.keys(FLOOR_FINISH_SHORT) as FloorFinish[]).map((f) => (
                      <option key={f} value={f}>{FLOOR_FINISH_SHORT[f]}</option>
                    ))}
                  </select></div>
                <div className="field"><label>Usual fixtures</label>
                  <input type="number" min={0} step={1} value={rt.fixtures} disabled={!canEdit} style={{ width: 70 }}
                    onChange={(e) => update((d) => {
                      const t = d.roomTypes.find((x) => x.id === rt.id);
                      if (t) t.fixtures = Number(e.target.value) || 0;
                    })} /></div>
                <div className="field"><label>How often</label>
                  <select value={rt.frequency} disabled={!canEdit}
                    onChange={(e) => update((d) => {
                      const t = d.roomTypes.find((x) => x.id === rt.id);
                      if (t) t.frequency = e.target.value;
                    })}>
                    {state.frequencies.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select></div>
              </div>
              <div className="field" style={{ marginBottom: 8 }}><label>Tasks (comma-separated)</label>
                <input type="text" value={rt.tasks.join(", ")} disabled={!canEdit}
                  onChange={(e) => update((d) => {
                    const t = d.roomTypes.find((x) => x.id === rt.id);
                    if (t) t.tasks = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                  })} /></div>
              {rt.qualifiers.length > 0 && (
                <div className="tablewrap">
                  <table className="grid">
                    <tbody>
                      {rt.qualifiers.map((qu) => (
                        <tr key={qu.id}>
                          <td>{qu.label}</td>
                          <td className="num" style={{ whiteSpace: "nowrap" }}>
                            <input type="number" min={0} step={qu.kind === "multiplier" ? 0.05 : 1} value={qu.value} disabled={!canEdit}
                              onChange={(e) => update((d) => {
                                const t = d.roomTypes.find((x) => x.id === rt.id);
                                const q2 = t?.qualifiers.find((x) => x.id === qu.id);
                                if (q2) q2.value = Number(e.target.value) || 0;
                              })} />
                            <span className="note"> {KIND_LABEL[qu.kind]}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </details>
        ))}
        {canEdit && (
          <button className="btn" style={{ marginTop: 12 }} onClick={() => setNewType(true)}>+ Add a room type</button>
        )}

        <details className="finetune" style={{ marginTop: 16 }}>
          <summary>Fine-tune: special multipliers & projects</summary>
          <div className="tablewrap" style={{ padding: "8px 0 0 14px" }}>
            <table className="grid">
              <tbody>
                {state.rates.modifiers.map((mod) => (
                  <tr key={mod.id}>
                    <td>{mod.name}</td>
                    <td className="num">
                      <input type="number" min={0} step={mod.kind === "multiplier" ? 0.05 : 5} value={mod.value} disabled={!canEdit}
                        onChange={(e) => update((d) => {
                          const m = d.rates.modifiers.find((x) => x.id === mod.id);
                          if (m) m.value = Number(e.target.value) || 0;
                        })} />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>Working minutes in one shift (drives the "staff needed" estimate)</td>
                  <td className="num">
                    <input type="number" min={60} step={5} value={state.rates.productiveMinutes} disabled={!canEdit}
                      onChange={(e) => update((d) => { d.rates.productiveMinutes = Number(e.target.value) || 420; })} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </Section>

      {/* ============ Shifts ============ */}
      <Section id="shifts" icon="🕐" title="Shifts" blurb="When your crews work, and each shift's color on the map.">
        {state.shifts.map((sh) => (
          <div className="deptrow" key={sh.id}>
            <input type="text" value={sh.name} disabled={!canEdit} style={{ width: 140 }}
              onChange={(e) => update((d) => {
                const s = d.shifts.find((x) => x.id === sh.id);
                if (s) s.name = e.target.value;
              })} />
            <input type="time" value={sh.start} disabled={!canEdit}
              onChange={(e) => update((d) => {
                const s = d.shifts.find((x) => x.id === sh.id);
                if (s) s.start = e.target.value;
              })} />
            <span className="note">to</span>
            <input type="time" value={sh.end} disabled={!canEdit}
              onChange={(e) => update((d) => {
                const s = d.shifts.find((x) => x.id === sh.id);
                if (s) s.end = e.target.value;
              })} />
            <span className="spacer" />
            <div className="colorpick">
              {COLOR_PALETTE.slice(0, 8).map((c) => (
                <button key={c} style={{ background: c }} className={sh.color === c ? "on" : ""}
                  aria-label="Use this color" disabled={!canEdit}
                  onClick={() => update((d) => {
                    const s = d.shifts.find((x) => x.id === sh.id);
                    if (s) s.color = c;
                  })} />
              ))}
            </div>
            {canEdit && (
              <button className="btn small danger" onClick={() => {
                const used = state.employees.some((e) => e.shiftId === sh.id)
                  || state.rooms.some((r) => r.shiftId === sh.id);
                if (used) { toast("People or rooms are still on this shift — move them first", true); return; }
                update((d) => { d.shifts = d.shifts.filter((x) => x.id !== sh.id); });
              }}>✕</button>
            )}
          </div>
        ))}
        {canEdit && (
          <button className="btn" style={{ marginTop: 12 }} onClick={() => update((d) => {
            d.shifts.push({ id: uid("sh"), name: "Nights", start: "23:00", end: "07:30", color: nextColor(d.shifts.map((s) => s.color)) });
          })}>+ Add a shift</button>
        )}
      </Section>

      {/* ============ Departments ============ */}
      <Section id="depts" icon="🏥" title="Departments" blurb="Each department gets a color on the map.">
        {!state.departments.length && <p className="note">Departments appear here automatically when you import rooms or type a department name on a room.</p>}
        {state.departments.map((dept) => (
          <div className="deptrow" key={dept.name}>
            <span className="cdot" style={{ background: dept.color, width: 14, height: 14 }} />
            <span className="nm">{dept.name}</span>
            <div className="colorpick">
              {COLOR_PALETTE.map((c) => (
                <button key={c} style={{ background: c }} className={dept.color === c ? "on" : ""}
                  aria-label="Use this color" disabled={!canEdit}
                  onClick={() => update((d) => {
                    const x = d.departments.find((y) => y.name === dept.name);
                    if (x) x.color = c;
                  })} />
              ))}
            </div>
          </div>
        ))}
      </Section>

      {/* ============ Team (remote only) ============ */}
      {auth.mode === "remote" && canEdit && (
        <Section id="team" icon="👥" title="Team & invites"
          blurb="Give supervisors and staff their own logins.">
          <div className="row">
            <div className="field"><label>They will be a…</label>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "supervisor" | "staff")}>
                <option value="supervisor">Supervisor (can change schedules)</option>
                <option value="staff">Staff (sees their own day, read-only)</option>
              </select></div>
            <button className="btn primary" onClick={() => void makeInvite()}>Create invite code</button>
            {inviteCode && <span className="invitecode">{inviteCode}</span>}
          </div>
          <p className="note" style={{ marginTop: 10 }}>
            Send them the code — they pick "Have an invite code?" on the sign-in screen.
          </p>
        </Section>
      )}

      {/* ============ Data ============ */}
      <Section id="data" icon="💾" title="Data" blurb="Back up, restore, or erase everything.">
        <div className="row" style={{ marginBottom: 14 }}>
          <button className="btn primary" onClick={() => {
            download(`opsmatrix-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2));
            toast("Backup downloaded ✓");
          }}>Download a backup</button>
          <input ref={restoreRef} type="file" accept=".json" style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleRestoreFile(f);
              e.target.value = "";
            }} />
          <button className="btn" onClick={() => restoreRef.current?.click()}>Restore from a backup…</button>
          {canEdit && <button className="btn danger" onClick={() => setConfirmErase(true)}>Erase everything</button>}
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          <p style={{ marginBottom: 6 }}><b>What this app stores:</b> your rooms and their sizes, cleaning times, shifts, people's names and who cleans what. That's all.</p>
          <p style={{ marginBottom: 6 }}><b>Never any patient information:</b> there is nowhere to put patient names or medical details — on purpose.</p>
          <p><b>Where it lives:</b> {auth.mode === "remote"
            ? "in your organization's own database — other organizations can never see it."
            : "right here in this browser on this computer — nothing is sent anywhere."}</p>
        </div>
      </Section>

      {newType && <NewRoomTypeModal onClose={() => setNewType(false)} />}

      {pendingRestore && (
        <Modal title="Restore this backup?" onClose={() => setPendingRestore(null)} buttons={[
          {
            label: "Restore", primary: true, onClick: () => {
              replaceState(pendingRestore);
              setPendingRestore(null);
              toast("Backup restored ✓");
            }
          },
          { label: "Cancel", onClick: () => setPendingRestore(null) }
        ]}>
          <p>
            This replaces everything with the backup ({pendingRestore.rooms.length} rooms,{" "}
            {pendingRestore.employees.length} people). Anything you changed since that backup will be lost
            {auth.mode === "remote" ? " for the whole organization" : ""}.
          </p>
        </Modal>
      )}

      {confirmErase && (
        <Modal title="Erase everything?" onClose={() => setConfirmErase(false)} buttons={[
          {
            label: "Erase", danger: true, onClick: async () => {
              if (auth.mode === "remote" && supabase) {
                const r = await supabase.rpc("delete_org_data");
                if (r.error) { toast(r.error.message, true); setConfirmErase(false); return; }
                await reload();
              } else {
                replaceState(defaultState());
              }
              setConfirmErase(false);
              toast("Everything erased");
            }
          },
          { label: "Cancel", onClick: () => setConfirmErase(false) }
        ]}>
          <p>
            Every room, schedule, person and setting will be removed
            {auth.mode === "remote" ? " for your organization" : " from this browser"}.
            Download a backup first if you're not sure.
          </p>
        </Modal>
      )}
    </div>
  );
}

function NewRoomTypeModal({ onClose }: { onClose: () => void }) {
  const { state, update } = useStore();
  const [name, setName] = useState("");
  const [finish, setFinish] = useState<FloorFinish>("hard");
  const [fixtures, setFixtures] = useState(0);
  const [frequency, setFrequency] = useState("7x");
  const [tasks, setTasks] = useState("Daily clean");
  const presets = qualifierPresets();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(presets.map((p) => [p.id, p.value]))
  );

  return (
    <Modal title="Add a room type" onClose={onClose} buttons={[
      {
        label: "Add it", primary: true, onClick: () => {
          if (!name.trim()) { toast("Please give the room type a name", true); return; }
          update((d) => {
            const tpl: RoomTypeTemplate = {
              id: uid("rt"), name: name.trim(), floorFinish: finish,
              fixtures, frequency,
              tasks: tasks.split(",").map((s) => s.trim()).filter(Boolean),
              qualifiers: presets
                .filter((p) => checked[p.id])
                .map((p) => ({ ...p, id: uid("q"), value: values[p.id] ?? p.value }))
            };
            d.roomTypes.push(tpl);
          });
          toast("Room type added ✓");
          onClose();
        }
      },
      { label: "Cancel", onClick: onClose }
    ]}>
      <div className="field" style={{ marginBottom: 10 }}><label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chapel" /></div>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="field"><label>Floor</label>
          <select value={finish} onChange={(e) => setFinish(e.target.value as FloorFinish)}>
            {(Object.keys(FLOOR_FINISH_SHORT) as FloorFinish[]).map((f) => (
              <option key={f} value={f}>{FLOOR_FINISH_SHORT[f]}</option>
            ))}
          </select></div>
        <div className="field"><label>Usual fixtures</label>
          <input type="number" min={0} step={1} value={fixtures} style={{ width: 70 }}
            onChange={(e) => setFixtures(Number(e.target.value) || 0)} /></div>
        <div className="field"><label>How often</label>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            {state.frequencies.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select></div>
      </div>
      <div className="field" style={{ marginBottom: 12 }}><label>Tasks (comma-separated)</label>
        <input type="text" value={tasks} onChange={(e) => setTasks(e.target.value)} /></div>
      <div className="field"><label>What makes this room take extra time?</label></div>
      {presets.map((p) => (
        <div className="row" key={p.id} style={{ padding: "5px 0", gap: 8 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: 1, fontSize: 13.5 }}>
            <input type="checkbox" checked={!!checked[p.id]}
              onChange={(e) => setChecked((c) => ({ ...c, [p.id]: e.target.checked }))} />
            {p.label}
          </label>
          {checked[p.id] && (
            <span style={{ whiteSpace: "nowrap" }}>
              <input type="number" min={0} step={p.kind === "multiplier" ? 0.05 : 1}
                value={values[p.id]} style={{ width: 70 }}
                onChange={(e) => setValues((v) => ({ ...v, [p.id]: Number(e.target.value) || 0 }))} />
              <span className="note"> {KIND_LABEL[p.kind]}</span>
            </span>
          )}
        </div>
      ))}
    </Modal>
  );
}
