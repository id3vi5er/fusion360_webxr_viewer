## 2024-10-18 - Accessible WebXR Status Updates
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers.
**Action:** Synchronize 3D text changes to a 2D HTML element with ARIA attributes (e.g., `aria-live="polite"`) placed inside the WebXR `dom-overlay`. Apply `.sr-only` to visually hide it while keeping it accessible.
