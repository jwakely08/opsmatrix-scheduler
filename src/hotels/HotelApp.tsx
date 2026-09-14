import React from "react";
import { useApp, Shell } from "./app";
import { HouseMapView } from "./HouseMap";
import { NextFourHoursView } from "./NextFourHours";
import { FrontDeskView } from "./FrontDesk";
import { RoomsView } from "./Rooms";
import { ScopeView } from "./Scope";
import { SettingsView } from "./Settings";
import { DesignView } from "./Design";

function Soon({ title, what }: { title: string; what: string }) {
  return <Shell title={title}><div className="empty"><h2>Coming in the next phase</h2><p>{what}</p></div></Shell>;
}

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
    case "walk": return <Soon title="Walk mode" what="Hold-to-talk capture, two-tap inspect, reassign." />;
    case "labor": return <Soon title="Labor" what="Today's demand, attendant boards, variance, what-if occupancy." />;
    case "handover": return <Soon title="Handover & reports" what="Generated shift snapshot, Daily Rooms Report, one button." />;
    case "scar": return <Soon title="Scar map" what="Space × failure type over 30 / 90 days." />;
    default: return <HouseMapView />;
  }
}
