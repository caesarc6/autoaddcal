import { createRoot, type Root } from "react-dom/client";
import { AutoSyncToggle, type AutoSyncToggleProps } from "./AutoSyncToggle";
import "./index.css";

const roots = new WeakMap<HTMLElement, Root>();

export function mountAutoSyncToggle(
  element: HTMLElement,
  props: AutoSyncToggleProps,
): void {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  root.render(<AutoSyncToggle {...props} />);
}

declare global {
  interface Window {
    mountAutoSyncToggle?: typeof mountAutoSyncToggle;
  }
}

window.mountAutoSyncToggle = mountAutoSyncToggle;
