import { useEffect, useState } from "react";

interface ToastMsg { id: number; text: string; err: boolean; }
let seq = 0;

export function toast(text: string, err = false) {
  window.dispatchEvent(new CustomEvent("om-toast", { detail: { id: ++seq, text, err } }));
}

export function ToastHost() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as ToastMsg;
      setItems((xs) => [...xs, d]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== d.id)), 3200);
    };
    window.addEventListener("om-toast", on);
    return () => window.removeEventListener("om-toast", on);
  }, []);
  return (
    <div id="toasthost">
      {items.map((t) => (
        <div key={t.id} className={"toast" + (t.err ? " err" : "")}>{t.text}</div>
      ))}
    </div>
  );
}
