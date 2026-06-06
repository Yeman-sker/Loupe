// Manual anomaly-flag hotkey (⌥⇧A). Lets the tester mark "what just happened is
// wrong" — the only way to catch product-level anomalies the code cannot detect.
// Chosen to not collide with the ⌥L picker toggle.

type KeyEventLike = {
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly key?: string;
  preventDefault?: () => void;
};

type DocumentLike = {
  addEventListener(type: "keydown", listener: (event: KeyEventLike) => void): void;
  removeEventListener(type: "keydown", listener: (event: KeyEventLike) => void): void;
};

export function isAnomalyChord(event: KeyEventLike): boolean {
  return event.altKey === true && event.shiftKey === true && (event.key === "a" || event.key === "A");
}

export function installAnomalyHotkey(doc: DocumentLike, onTrigger: () => void): () => void {
  const handler = (event: KeyEventLike): void => {
    if (!isAnomalyChord(event)) return;
    event.preventDefault?.();
    onTrigger();
  };
  doc.addEventListener("keydown", handler);
  return () => doc.removeEventListener("keydown", handler);
}
