// Max Floor Care equipment catalog — manufacturer-published productivity,
// transcribed from Josh's four-brand reference sheets (Tennant, Advance,
// TASKI, Clarke; sourced from manufacturer pages, accessed 2026-08-23).
//
// Rates are the SCHEDULING rate each sheet recommends: the manufacturer's
// practical/overlap/average figure when one is published, otherwise the
// published maximum — the `basis` field says which. These are machine-run
// benchmarks, not complete labor standards; travel, fill/dump, pad changes
// and obstacles are the client's operational reality on top.
//
// A machine with sqftPerHour: null is a real catalog model whose maker
// publishes no timed rate — selectable, but the client supplies the rate.
// Every category also accepts a fully custom machine. NOTE: no manufacturer
// sweeper reference has been provided yet, so Machine Sweeping currently
// offers custom entry only — drop in a sweeper sheet like the others and
// the list fills in.

export type FloorCareCategory =
  | "machine-scrub" | "dust-mop" | "burnish" | "machine-sweep" | "machine-carpet";

export interface Machine {
  brand: "Tennant" | "Advance" | "Clarke" | "TASKI";
  model: string;
  kind: string;          // walk-behind / ride-on / stand-on…
  pathIn: string;        // cleaning path
  sqftPerHour: number | null;
  basis: string;         // OEM practical / OEM max / theoretical…
}

export const MANUFACTURERS = ["Tennant", "Advance", "Clarke", "TASKI"] as const;

export const EQUIPMENT: Record<FloorCareCategory, Machine[]> = {
  "machine-scrub": [
    // Tennant — published productivity (maximum/"up to")
    { brand: "Tennant", model: "T1", kind: "Micro walk-behind", pathIn: "15 in", sqftPerHour: 15920, basis: "OEM max" },
    { brand: "Tennant", model: "T1B", kind: "Micro walk-behind", pathIn: "15 in", sqftPerHour: 14875, basis: "OEM max" },
    { brand: "Tennant", model: "T2", kind: "Compact walk-behind", pathIn: "17 in", sqftPerHour: 20230, basis: "OEM max" },
    { brand: "Tennant", model: "T260", kind: "Small walk-behind", pathIn: "20 in", sqftPerHour: 21120, basis: "OEM max" },
    { brand: "Tennant", model: "T290", kind: "Small walk-behind", pathIn: "20 in", sqftPerHour: 19600, basis: "OEM max" },
    { brand: "Tennant", model: "T300", kind: "Walk-behind", pathIn: "17–24 in", sqftPerHour: 24000, basis: "OEM max" },
    { brand: "Tennant", model: "T300e", kind: "Walk-behind", pathIn: "17–24 in", sqftPerHour: 24000, basis: "OEM max" },
    { brand: "Tennant", model: "T350", kind: "Stand-on", pathIn: "20/24 in", sqftPerHour: 38016, basis: "OEM max" },
    { brand: "Tennant", model: "T390", kind: "Medium walk-behind", pathIn: "28 in", sqftPerHour: 26950, basis: "OEM max" },
    { brand: "Tennant", model: "T391", kind: "Medium walk-behind", pathIn: "28/32 in", sqftPerHour: 47953, basis: "OEM max" },
    { brand: "Tennant", model: "T500", kind: "Medium walk-behind", pathIn: "26–32 in", sqftPerHour: 35200, basis: "OEM max" },
    { brand: "Tennant", model: "T500e", kind: "Medium walk-behind", pathIn: "26–32 in", sqftPerHour: 35200, basis: "OEM max" },
    { brand: "Tennant", model: "T600", kind: "Large walk-behind", pathIn: "28–36 in", sqftPerHour: 47520, basis: "OEM max" },
    { brand: "Tennant", model: "T600e", kind: "Large walk-behind", pathIn: "28–36 in", sqftPerHour: 47520, basis: "OEM max" },
    { brand: "Tennant", model: "T581", kind: "Micro ride-on", pathIn: "20 in", sqftPerHour: 32700, basis: "OEM max" },
    { brand: "Tennant", model: "T681", kind: "Small ride-on", pathIn: "33.5 in", sqftPerHour: 54605, basis: "OEM max" },
    { brand: "Tennant", model: "T981 (disk)", kind: "Ride-on", pathIn: "36 in", sqftPerHour: 57049, basis: "OEM max" },
    { brand: "Tennant", model: "T981 (cylindrical)", kind: "Ride-on", pathIn: "30 in", sqftPerHour: 46285, basis: "OEM max" },
    { brand: "Tennant", model: "T7", kind: "Ride-on", pathIn: "26/32 in", sqftPerHour: 56320, basis: "OEM max" },
    { brand: "Tennant", model: "T12", kind: "Compact ride-on", pathIn: "32/41 in", sqftPerHour: 72160, basis: "OEM max" },
    { brand: "Tennant", model: "T1581 (disk)", kind: "Ride-on", pathIn: "41.3 in", sqftPerHour: 69513, basis: "OEM max" },
    { brand: "Tennant", model: "T1581 (cylindrical)", kind: "Ride-on", pathIn: "38.7 in", sqftPerHour: 76262, basis: "OEM max" },
    { brand: "Tennant", model: "T16", kind: "Large ride-on", pathIn: "36–46 in", sqftPerHour: 89100, basis: "OEM max" },
    { brand: "Tennant", model: "T17", kind: "Heavy-duty ride-on", pathIn: "40–52 in", sqftPerHour: 125840, basis: "OEM max" },
    { brand: "Tennant", model: "T20", kind: "Industrial ride-on", pathIn: "40–56 in", sqftPerHour: 130680, basis: "OEM max" },
    // Advance — published maximum/theoretical
    { brand: "Advance", model: "SC100", kind: "Upright micro", pathIn: "12.2 in", sqftPerHour: 2434, basis: "OEM max" },
    { brand: "Advance", model: "SC250", kind: "Micro walk-behind", pathIn: "13.5 in", sqftPerHour: 14369, basis: "OEM max" },
    { brand: "Advance", model: "SC351", kind: "Compact walk-behind", pathIn: "14.5 in", sqftPerHour: 9500, basis: "OEM max" },
    { brand: "Advance", model: "SC400 E", kind: "Small walk-behind", pathIn: "17 in", sqftPerHour: 14960, basis: "OEM max" },
    { brand: "Advance", model: "SC400 B", kind: "Small walk-behind", pathIn: "17 in", sqftPerHour: 22400, basis: "OEM max" },
    { brand: "Advance", model: "SC450", kind: "Small walk-behind", pathIn: "20 in", sqftPerHour: 26400, basis: "OEM max" },
    { brand: "Advance", model: "Adfinity X20C", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: 26400, basis: "OEM max" },
    { brand: "Advance", model: "Adfinity X24D", kind: "Walk-behind", pathIn: "24 in", sqftPerHour: 31680, basis: "OEM max" },
    { brand: "Advance", model: "SC500 Disc", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: 24552, basis: "OEM max" },
    { brand: "Advance", model: "SC500 REV", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: 24552, basis: "OEM max" },
    { brand: "Advance", model: "SC750 26D", kind: "Mid-size walk-behind", pathIn: "26 in", sqftPerHour: 38900, basis: "OEM max" },
    { brand: "Advance", model: "SC750 28D/28C/REV", kind: "Mid-size walk-behind", pathIn: "28 in", sqftPerHour: 41900, basis: "OEM max" },
    { brand: "Advance", model: "SC800 28D/28C", kind: "Large walk-behind", pathIn: "28 in", sqftPerHour: 41900, basis: "OEM max" },
    { brand: "Advance", model: "SC800 32C", kind: "Large walk-behind", pathIn: "32 in", sqftPerHour: 47900, basis: "OEM max" },
    { brand: "Advance", model: "SC800 34D", kind: "Large walk-behind", pathIn: "34 in", sqftPerHour: 50900, basis: "OEM max" },
    { brand: "Advance", model: "SC900 28D", kind: "Large walk-behind", pathIn: "28 in", sqftPerHour: 28028, basis: "OEM max" },
    { brand: "Advance", model: "SC900 32C", kind: "Large walk-behind", pathIn: "32 in", sqftPerHour: 31915, basis: "OEM max" },
    { brand: "Advance", model: "SC900 34D", kind: "Large walk-behind", pathIn: "34 in", sqftPerHour: 34034, basis: "OEM max" },
    { brand: "Advance", model: "SC1500 D/REV", kind: "Stand-on", pathIn: "20 in", sqftPerHour: 26400, basis: "OEM max" },
    { brand: "Advance", model: "SC2000 X20D", kind: "Micro rider", pathIn: "20 in", sqftPerHour: 32560, basis: "OEM max" },
    { brand: "Advance", model: "SC3000", kind: "Compact rider", pathIn: "26 in", sqftPerHour: 42328, basis: "OEM max" },
    { brand: "Advance", model: "2800 ST", kind: "Rider", pathIn: "28 in", sqftPerHour: 39424, basis: "OEM max" },
    { brand: "Advance", model: "3400 ST", kind: "Rider", pathIn: "34 in", sqftPerHour: 47872, basis: "OEM max" },
    { brand: "Advance", model: "Advenger 2400", kind: "Rider", pathIn: "24 in", sqftPerHour: 40128, basis: "OEM max (3.8 mph)" },
    { brand: "Advance", model: "Advenger 2600", kind: "Rider", pathIn: "26 in", sqftPerHour: 43472, basis: "OEM max (3.8 mph)" },
    { brand: "Advance", model: "Advenger 2810", kind: "Rider", pathIn: "28 in", sqftPerHour: 46816, basis: "OEM max (3.8 mph)" },
    { brand: "Advance", model: "Advenger 3210", kind: "Rider", pathIn: "32 in", sqftPerHour: 53504, basis: "OEM max (3.8 mph)" },
    { brand: "Advance", model: "Advenger REV", kind: "Rider", pathIn: "28 in", sqftPerHour: 39424, basis: "OEM max" },
    { brand: "Advance", model: "Adgressor 3520", kind: "Heavy-duty rider", pathIn: "35 in", sqftPerHour: 61600, basis: "OEM max" },
    { brand: "Advance", model: "Adgressor 3820", kind: "Heavy-duty rider", pathIn: "38 in", sqftPerHour: 66880, basis: "OEM max" },
    { brand: "Advance", model: "SC6000 34D", kind: "Industrial rider", pathIn: "34 in", sqftPerHour: 88250, basis: "OEM max" },
    { brand: "Advance", model: "SC6000 36C", kind: "Industrial rider", pathIn: "36 in", sqftPerHour: 93450, basis: "OEM max" },
    { brand: "Advance", model: "SC6000 40D", kind: "Industrial rider", pathIn: "40 in", sqftPerHour: 103850, basis: "OEM max" },
    { brand: "Advance", model: "SC6500 40C/40D", kind: "Industrial rider", pathIn: "40 in", sqftPerHour: 96800, basis: "OEM max" },
    { brand: "Advance", model: "SC6500 45C/45D", kind: "Industrial rider", pathIn: "45 in", sqftPerHour: 108900, basis: "OEM max" },
    { brand: "Advance", model: "SC6500 48C/48D", kind: "Industrial rider", pathIn: "48 in", sqftPerHour: 116200, basis: "OEM max" },
    { brand: "Advance", model: "SC8000 48", kind: "Engine rider", pathIn: "48 in", sqftPerHour: 73900, basis: "OEM max" },
    { brand: "Advance", model: "SC8000 60", kind: "Engine rider", pathIn: "60 in", sqftPerHour: 92400, basis: "OEM max" },
    // TASKI — practical rate when published (their sheets recommend it)
    { brand: "TASKI", model: "ULTIMAXX 360", kind: "Compact walk-behind", pathIn: "19.3 in", sqftPerHour: 15823, basis: "theoretical" },
    { brand: "TASKI", model: "ULTIMAXX 900 SD-43 Economy", kind: "Walk-behind", pathIn: "16.9 in", sqftPerHour: 10419, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 900 SD-50 Economy", kind: "Walk-behind", pathIn: "19.7 in", sqftPerHour: 12109, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 900 DD-55", kind: "Walk-behind", pathIn: "21.7 in", sqftPerHour: 13326, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 900 Roller-45", kind: "Walk-behind", pathIn: "17.7 in", sqftPerHour: 10904, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 1900 SD-43 Economy", kind: "Walk-behind", pathIn: "16.9 in", sqftPerHour: 10419, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 1900 SD-50 Economy", kind: "Walk-behind", pathIn: "19.7 in", sqftPerHour: 12109, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 1900 SD-43 Performance", kind: "Walk-behind", pathIn: "16.9 in", sqftPerHour: 15629, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 1900 SD-50 Performance", kind: "Walk-behind", pathIn: "19.7 in", sqftPerHour: 18169, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 1900 DD-55 Economy", kind: "Walk-behind", pathIn: "21.7 in", sqftPerHour: 13326, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 1900 DD-55 Performance", kind: "Walk-behind", pathIn: "21.7 in", sqftPerHour: 19978, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 1900 DD-65 Performance", kind: "Walk-behind", pathIn: "25.6 in", sqftPerHour: 23616, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 1900 Roller-55 Performance", kind: "Walk-behind", pathIn: "21.7 in", sqftPerHour: 19978, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 1900 Roller-65 Performance", kind: "Walk-behind", pathIn: "25.6 in", sqftPerHour: 23616, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 1900 Orbital-50 Performance", kind: "Walk-behind", pathIn: "19.7 in", sqftPerHour: 18164, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 2900 SD-50 Performance", kind: "Walk-behind", pathIn: "19.7 in", sqftPerHour: 18169, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 2900 DD-55 Performance", kind: "Walk-behind", pathIn: "21.7 in", sqftPerHour: 19978, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 2900 DD-65 Performance", kind: "Walk-behind", pathIn: "25.6 in", sqftPerHour: 23616, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 2900 Roller-55 Performance", kind: "Walk-behind", pathIn: "21.7 in", sqftPerHour: 19978, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 2900 Roller-65 Performance", kind: "Walk-behind", pathIn: "25.6 in", sqftPerHour: 23616, basis: "OEM practical" },
    { brand: "TASKI", model: "ULTIMAXX 2900 Orbital-50 Performance", kind: "Walk-behind", pathIn: "19.7 in", sqftPerHour: 18169, basis: "OEM practical" },
    { brand: "TASKI", model: "swingo 250micro", kind: "Micro walk-behind", pathIn: "17.3 in", sqftPerHour: 14208, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 350B", kind: "Compact walk-behind", pathIn: "15 in", sqftPerHour: 12271, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 455B", kind: "Small walk-behind", pathIn: "16.9 in", sqftPerHour: 13885, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 755 E", kind: "Corded walk-behind", pathIn: "19.7 in", sqftPerHour: 13885, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 755 B Eco", kind: "Walk-behind", pathIn: "16.9 in", sqftPerHour: 13885, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 755 B Power", kind: "Walk-behind traction", pathIn: "16.9 in", sqftPerHour: 20828, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 855 B Power", kind: "Walk-behind traction", pathIn: "19.7 in", sqftPerHour: 24219, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 955 B", kind: "Walk-behind traction", pathIn: "21.7 in", sqftPerHour: 26641, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 1255 E", kind: "Corded large walk-behind", pathIn: "19.7 in", sqftPerHour: 16146, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 1255 B", kind: "Large walk-behind traction", pathIn: "21.7 in", sqftPerHour: 26641, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 1650", kind: "Large walk-behind", pathIn: "25.6 in", sqftPerHour: 31484, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 1850", kind: "Large walk-behind", pathIn: "33.5 in", sqftPerHour: 41172, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 2100micro", kind: "Compact ride-on", pathIn: "21.7 in", sqftPerHour: 32561, basis: "theoretical" },
    { brand: "TASKI", model: "swingo XP-R", kind: "Stand-on", pathIn: "29.5 in", sqftPerHour: 48438, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 2500", kind: "Ride-on", pathIn: "27.6 in", sqftPerHour: 48976, basis: "technical-table theoretical" },
    { brand: "TASKI", model: "swingo 4000", kind: "Large ride-on", pathIn: "33.5 in", sqftPerHour: 68620, basis: "theoretical" },
    { brand: "TASKI", model: "swingo 5000", kind: "Large ride-on", pathIn: "41.3 in", sqftPerHour: 84766, basis: "theoretical" }
  ],

  "burnish": [
    { brand: "Tennant", model: "BR-1600-NDC", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: 10000, basis: "OEM max" },
    { brand: "Tennant", model: "BR-2000-DC", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: 10000, basis: "OEM max" },
    { brand: "Tennant", model: "B5 (pad assist)", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: 13500, basis: "OEM 2-in overlap" },
    { brand: "Tennant", model: "B5 (propel)", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: 18000, basis: "OEM 2-in overlap" },
    { brand: "Tennant", model: "B7 (24 in)", kind: "Walk-behind", pathIn: "24 in", sqftPerHour: 22000, basis: "OEM 2-in overlap" },
    { brand: "Tennant", model: "B7 (27 in)", kind: "Walk-behind", pathIn: "27 in", sqftPerHour: 25000, basis: "OEM 2-in overlap" },
    { brand: "Tennant", model: "B10 (24 in)", kind: "Ride-on", pathIn: "24 in", sqftPerHour: 30250, basis: "OEM max" },
    { brand: "Tennant", model: "B10 (27 in)", kind: "Ride-on", pathIn: "27 in", sqftPerHour: 34375, basis: "OEM max" },
    { brand: "Advance", model: "BU800 20B/20BT", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: 17600, basis: "OEM practical" },
    { brand: "Advance", model: "BU800 24B/24BT", kind: "Walk-behind", pathIn: "24 in", sqftPerHour: 21120, basis: "OEM practical" },
    { brand: "Advance", model: "Advolution 2710", kind: "Ride-on", pathIn: "27 in", sqftPerHour: 30000, basis: "OEM average (lower bound)" },
    { brand: "Advance", model: "PBU Series 21", kind: "Walk-behind propane", pathIn: "21 in", sqftPerHour: 25000, basis: "OEM rate" },
    { brand: "Advance", model: "PBU Series 27", kind: "Walk-behind propane", pathIn: "27 in", sqftPerHour: 33000, basis: "OEM rate" },
    { brand: "Advance", model: "Advolution 20", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: null, basis: "no OEM rate published" },
    { brand: "Advance", model: "Advolution 20XP", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: null, basis: "no OEM rate published" },
    { brand: "Clarke", model: "Ultra Speed 20/20T", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: 24000, basis: "OEM polishing rate" },
    { brand: "Clarke", model: "PBU Propane 21", kind: "Walk-behind propane", pathIn: "21 in", sqftPerHour: 25000, basis: "OEM rate" },
    { brand: "Clarke", model: "PBU Propane 27", kind: "Walk-behind propane", pathIn: "27 in", sqftPerHour: 33000, basis: "OEM rate" },
    { brand: "Clarke", model: "Ultra Speed US1500DC", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: null, basis: "no OEM rate published" },
    { brand: "Clarke", model: "Ultra Speed US2000DC", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: null, basis: "no OEM rate published" },
    { brand: "Clarke", model: "Ultra Speed Pro 1500", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: null, basis: "no OEM rate published" },
    { brand: "TASKI", model: "eForce", kind: "Ride-on", pathIn: "27 in", sqftPerHour: 35640, basis: "OEM max" },
    { brand: "TASKI", model: "Charger 2022 ABLT", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: 16300, basis: "OEM productivity" },
    { brand: "TASKI", model: "Charger 2717 DB", kind: "Walk-behind/stand-on", pathIn: "27 in", sqftPerHour: null, basis: "no OEM rate published" },
    { brand: "TASKI", model: "Charger 2022 DB", kind: "Walk-behind/stand-on", pathIn: "20 in", sqftPerHour: null, basis: "no OEM rate published" },
    { brand: "TASKI", model: "Charger 1500", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: null, basis: "no OEM rate published" },
    { brand: "TASKI", model: "Mustang 1500", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: null, basis: "no OEM rate published" },
    { brand: "TASKI", model: "Galaxy 1500", kind: "Walk-behind", pathIn: "20 in", sqftPerHour: null, basis: "no OEM rate published" },
    { brand: "TASKI", model: "ergodisc 1200", kind: "Walk-behind UHS", pathIn: "—", sqftPerHour: null, basis: "no OEM rate published" },
    { brand: "TASKI", model: "ergodisc 2000", kind: "Walk-behind UHS", pathIn: "—", sqftPerHour: null, basis: "no OEM rate published" }
  ],

  "machine-carpet": [
    { brand: "Tennant", model: "R3 (ReadySpace)", kind: "Compact walk-behind", pathIn: "15 in", sqftPerHour: 3250, basis: "OEM average" },
    { brand: "Tennant", model: "1510 (interim)", kind: "Battery walk-behind", pathIn: "19 in", sqftPerHour: 11000, basis: "OEM theoretical max" },
    { brand: "Tennant", model: "1530 (interim)", kind: "Corded walk-behind", pathIn: "19 in", sqftPerHour: 11000, basis: "OEM theoretical max" },
    { brand: "Tennant", model: "1610 (ReadySpace)", kind: "Battery walk-behind", pathIn: "22 in", sqftPerHour: 13000, basis: "OEM max" },
    { brand: "Tennant", model: "R14 (ReadySpace)", kind: "Ride-on", pathIn: "28 in", sqftPerHour: 10000, basis: "OEM est. coverage" },
    { brand: "Advance", model: "AquaPLUS AXP (LIFT)", kind: "Battery walk-behind", pathIn: "24 in", sqftPerHour: 10800, basis: "OEM coverage" },
    { brand: "Advance", model: "Adphibian (LIFT)", kind: "Battery walk-behind", pathIn: "24 in", sqftPerHour: 10800, basis: "OEM coverage" },
    { brand: "Advance", model: "ES4000 (interim)", kind: "Ride-on", pathIn: "28 in", sqftPerHour: 14000, basis: "OEM interim rate" },
    { brand: "Advance", model: "ES300 XP (LIFT)", kind: "Walk-behind", pathIn: "16 in", sqftPerHour: null, basis: "no OEM rate published" },
    { brand: "Advance", model: "ES400 XLP (LIFT)", kind: "Walk-behind", pathIn: "18 in", sqftPerHour: null, basis: "no OEM rate published" },
    { brand: "Advance", model: "AquaClean 16XP", kind: "Walk-behind", pathIn: "16 in", sqftPerHour: null, basis: "OEM gives per-tank coverage only" },
    { brand: "Advance", model: "AquaClean 18FLX", kind: "Walk-behind", pathIn: "18 in", sqftPerHour: null, basis: "OEM gives per-tank coverage only" },
    { brand: "Clarke", model: "Clean Track L24 (LIFT)", kind: "Battery walk-behind", pathIn: "24 in", sqftPerHour: 10800, basis: "OEM coverage" },
    { brand: "TASKI", model: "procarpet 30 (encapsulation)", kind: "Corded walk-behind", pathIn: "14.9 in", sqftPerHour: 4359, basis: "OEM practical" },
    { brand: "TASKI", model: "procarpet 45 (encapsulation)", kind: "Corded walk-behind", pathIn: "17.7 in", sqftPerHour: 4790, basis: "OEM practical" }
  ],

  // No manufacturer reference sheet has been provided for sweepers yet —
  // the category works via custom machines until one is dropped in.
  "machine-sweep": [],

  // dust mopping is manual: the "equipment" is the mop width (see below)
  "dust-mop": []
};

/**
 * Dust-mop productivity by mop width — ISSA-style starting rates for a
 * clear, open corridor pass. Editable estimates, not gospel: pick the width,
 * adjust the rate if the client's standard differs.
 */
export const DUST_MOP_SIZES: { widthIn: number; sqftPerHour: number }[] = [
  { widthIn: 18, sqftPerHour: 12000 },
  { widthIn: 24, sqftPerHour: 15000 },
  { widthIn: 30, sqftPerHour: 17500 },
  { widthIn: 36, sqftPerHour: 20000 },
  { widthIn: 42, sqftPerHour: 22500 },
  { widthIn: 48, sqftPerHour: 25000 },
  { widthIn: 60, sqftPerHour: 28000 },
  { widthIn: 72, sqftPerHour: 30000 }
];

/** the five floor-care task ids ↔ equipment categories */
export const FLOORCARE_CATEGORY_OF_TASK: Record<string, FloorCareCategory> = {
  "dust-mop": "dust-mop",
  "burnish": "burnish",
  "auto-scrub": "machine-scrub",
  "machine-sweep": "machine-sweep",
  "machine-carpet": "machine-carpet"
};

export function brandsFor(category: FloorCareCategory): string[] {
  return [...new Set(EQUIPMENT[category].map((m) => m.brand))];
}

export function modelsFor(category: FloorCareCategory, brand: string): Machine[] {
  return EQUIPMENT[category].filter((m) => m.brand === brand);
}
