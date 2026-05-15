## 2026-05-15 - Add ARIA live region for 3D text in WebXR
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers. To provide accessible status updates, synchronize 3D text changes to a 2D HTML element with ARIA attributes (e.g., aria-live="polite") placed inside the WebXR dom-overlay.
**Action:** Use dom-overlay and .sr-only visually hidden elements in WebXR applications to mirror 3D status text to screen readers.
