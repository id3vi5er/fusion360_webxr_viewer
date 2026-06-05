## 2024-05-24 - WebXR DOM Overlay Accessibility
**Learning:** 3D text rendered via Three.js canvas textures is inaccessible to screen readers in WebXR.
**Action:** Synchronize status text changes to a 2D HTML element with `aria-live="polite"` inside an invisible (`.sr-only`) WebXR `dom-overlay` with `pointer-events: none;`.
