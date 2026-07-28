import React from "react";

export interface ModalButton {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick: () => void;
}

export function Modal({ title, buttons, onClose, children }: {
  title: string; buttons: ModalButton[]; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="modalback" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="mhead"><h3>{title}</h3></div>
        <div className="mbody">{children}</div>
        <div className="mfoot">
          {buttons.map((b, i) => (
            <button key={i}
              className={"btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : "")}
              onClick={b.onClick}>{b.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
