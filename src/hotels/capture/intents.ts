// AMBIENT CAPTURE — the intent contract. A manager walks the building and
// talks; speech (or typed text) becomes structured intents with a confidence
// and a plain-English readback. Nothing writes without the readback shown.
import type { Condition, WorkOrder, IntentType } from "../store";

export interface Intent {
  type: IntentType;
  /** room number / suite label the intent is about (as spoken, resolved by apply) */
  room?: string;
  confidence: number;
  /** plain English, e.g. "412 → AC blowing warm → work order → Engineering" */
  readback: string;
  condition?: Condition;
  text?: string;
  category?: WorkOrder["category"];
  blocking?: boolean;
  staff?: string;
  task?: "departure" | "stayover" | "turndown" | "deep" | "inspect" | "repair" | "public";
  flag?: "do_not_walk" | "walk_ok" | "vip" | "not_vip";
  notes?: string;
}

export interface CaptureContext {
  /** room numbers and suite labels that exist ("412", "Suite 420") */
  rooms: string[];
  staff: { name: string; role: string }[];
  /** the room the manager is standing in / has open */
  currentRoom?: string;
  floor?: string;
  hotelName?: string;
  openWorkOrders?: { room: string; text: string }[];
}

export const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intents"],
  properties: {
    intents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "confidence", "readback"],
        properties: {
          type: { type: "string", enum: ["set_condition", "create_work_order", "assign", "inspect_pass", "inspect_fail", "note", "flag", "report_line"] },
          room: { type: "string" },
          confidence: { type: "number" },
          readback: { type: "string" },
          condition: { type: "string", enum: ["dirty", "in_progress", "clean", "inspected", "pickup"] },
          text: { type: "string" },
          category: { type: "string", enum: ["hvac", "plumbing", "electrical", "furniture", "minibar", "tv", "housekeeping", "other"] },
          blocking: { type: "boolean" },
          staff: { type: "string" },
          task: { type: "string", enum: ["departure", "stayover", "turndown", "deep", "inspect", "repair", "public"] },
          flag: { type: "string", enum: ["do_not_walk", "walk_ok", "vip", "not_vip"] },
          notes: { type: "string" }
        }
      }
    }
  }
} as const;
