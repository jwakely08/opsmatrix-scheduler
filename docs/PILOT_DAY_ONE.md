# OpsMatrix Hotels — Pilot, Day One

What a hotel sends us, and what they see by lunch. Local concept build: everything runs in the browser at `hotels.html`; nothing is connected to a PMS yet.

## What we ask the hotel for (the night before)

1. **A floor plan** — PDF, picture, or CAD export, one per guest floor plus the lobby level. Printed square footages help but aren't required. *(Concept build: the demo hotel "The Meridian" ships drawn in; a real plan goes through the same floor-plan reader the hospital product uses, which is the next wiring step.)*
2. **A room list** — CSV or a pasted spreadsheet. Columns we understand: `Room, Name, Floor, Type, Sq Ft, Suite, Condition, Occupancy, Promised, Guest, VIP, OOO`. Only `Room` is required. Suites are rooms sharing a `Suite` value. Re-imports update by room number and never duplicate.
3. **A 14-day occupancy sheet** — one line per day: `date, arrivals, departures, stayovers`. From the PMS forecast report, or typed.
4. **The roster** — attendants by floor, inspector, engineering, front desk, GM. *(Concept build: edited in the demo data; a roster import is a five-line addition to the CSV importer.)*

Nothing else. No guest names, no folios, no card data, no payroll.

## What they see by lunch

| Time | Screen | What it shows |
|---|---|---|
| 09:00 | **Rooms & spaces → Import room list** | Every room, type, size, suite, and this morning's condition and arrivals loaded in one paste. |
| 09:15 | **House map** | The floor plan with five layers: Ready verdict, Cleaning, Occupancy, Engineering, Who's on it. Tap a room for the drawer. |
| 09:30 | **Scope** | Their departure / stayover / turndown minutes by room type, public-area rates, travel per floor change, 420 productive minutes × 5 shifts. All editable. |
| 10:00 | **Labor** | Attendants needed today from the real room mix, contiguous boards per attendant, and the dollar difference against a scattered call-down list. 14-day plan from the pasted sheet. |
| 10:30 | **Walk mode** on the HK manager's phone | Hold to talk: "412 AC blowing warm, minibar door hanging open, pull it from tonight's arrivals, give it to Marco." Four readback cards, one tap. Two work orders, room red, do-not-walk, Marco assigned, four handover lines, one scar. |
| 11:00 | **Next four hours** | Arrival rooms that will miss their promised time, with minutes needed. |
| 11:30 | **Front desk** on the desk screen | Tonight's arrivals and the verdict only. Privacy mode: room codes, not names. Nobody at the desk can turn a hold green. |
| 12:00 | **Handover & reports** | The morning's shift handover, generated. PDF or share sheet. Nobody typed it. |

## The rules the hotel will notice

- **A stale or missing signal never shows green.** If nobody has confirmed a room's condition inside the freshness window (Settings, default 15 minutes), the room reads Unknown — hatched, not gray-green.
- **One official condition.** The status feed is the truth; when a PMS is connected, its condition wins.
- **The front desk cannot override.** The GM can override a hold with a logged reason; never a red, never an unknown.
- **Disconnecting the feed paints every room Unknown** — there is a button in Settings to show this.

## What is deferred until the concept becomes a product

Logins and per-property isolation, the Mews adapter (rooms, reservations, condition, webhooks), write-back (off by default, field by field, logged), and the plan reader hookup for real hotel PDFs. The engine pieces they plug into already exist in the hospital product.
