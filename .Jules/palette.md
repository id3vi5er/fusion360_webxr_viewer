## 2024-05-06 - Accessible WebXR Status Updates
**Learning:** 3D text rendered via canvas/meshes in WebXR is inherently inaccessible to screen readers.
**Action:** Always synchronize 3D status text to a 2D HTML element with `aria-live="polite"` inside a WebXR `dom-overlay` with `pointer-events: none;` and visually hidden styling (`.sr-only`).
