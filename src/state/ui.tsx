import { createContext, useContext } from "react";
import type { Role } from "../auth/AuthContext";

export interface UICtx {
  openRoom: (roomId: string) => void;
  closeRoom: () => void;
  printSchedules: () => void;
  role: Role;
  /** convenience permission flags derived from role */
  canEditFacility: boolean;
  canEditSchedule: boolean;
}

export const UIContext = createContext<UICtx>({
  openRoom: () => {}, closeRoom: () => {}, printSchedules: () => {},
  role: "director", canEditFacility: true, canEditSchedule: true
});

export function useUI(): UICtx {
  return useContext(UIContext);
}
