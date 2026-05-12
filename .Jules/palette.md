## 2024-05-13 - Accessible WebXR Status Updates
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers.
**Action:** Synchronize 3D text updates to a visually hidden (`.sr-only`) HTML element with `aria-live="polite"` inside a WebXR `dom-overlay` to ensure screen readers can announce status changes during an AR session.
