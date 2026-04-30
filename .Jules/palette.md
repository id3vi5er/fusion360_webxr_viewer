## 2024-10-25 - Accessible WebXR Status Updates
**Learning:** 3D text meshes and canvas textures in WebXR are inherently inaccessible to screen readers.
**Action:** Synchronize 3D text changes to a visually hidden 2D HTML element with ARIA live regions (`aria-live="polite"`) placed inside a WebXR `dom-overlay`. Ensure the DOM overlay root is not hidden with `display: none`.
