## 2024-05-21 - WebXR Screen Reader Support
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers. To provide accessible status updates, we must synchronize 3D text changes to a 2D HTML element with ARIA attributes (e.g., `aria-live="polite"`) placed inside the WebXR `dom-overlay`. The root overlay element must not have `display: none;` and should have `pointer-events: none;` to not block interaction.
**Action:** Always implement a `dom-overlay` with an `aria-live` region mirroring status text when building WebXR applications.
