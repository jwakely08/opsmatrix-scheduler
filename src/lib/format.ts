export function fmt(n: number | null | undefined, dp = 0): string {
  if (n === null || n === undefined || isNaN(n)) return "–";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtHrs(mins: number): string {
  if (!mins) return "0 h";
  return (mins / 60).toFixed(1) + " h";
}

export function todayStr(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export function download(name: string, text: string, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
