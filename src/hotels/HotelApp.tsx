import React from "react";
import { useApp } from "./app";
import { HouseMapView } from "./HouseMap";
import { NextFourHoursView } from "./NextFourHours";
import { FrontDeskView } from "./FrontDesk";
import { RoomsView } from "./Rooms";
import { ScopeView } from "./Scope";
import { SettingsView } from "./Settings";
import { DesignView } from "./Design";
import { WalkView } from "./Walk";
import { LaborView } from "./Labor";
import { HandoverView } from "./Handover";
import { ScarView } from "./Scar";

export function HotelApp() {
  const { view } = useApp();
  switch (view) {
    case "map": return <HouseMapView />;
    case "next": return <NextFourHoursView />;
    case "desk": return <FrontDeskView />;
    case "rooms": return <RoomsView />;
    case "scope": return <ScopeView />;
    case "settings": return <SettingsView />;
    case "design": return <DesignView />;
    case "walk": return <WalkView />;
    case "labor": return <LaborView />;
    case "handover": return <HandoverView />;
    case "scar": return <ScarView />;
    default: return <HouseMapView />;
  }
}
