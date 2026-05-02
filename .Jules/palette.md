## 2026-05-02 - WebXR Accessibility for 3D Text
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers.
**Action:** Synchronize 3D text changes to a 2D HTML element with ARIA attributes (e.g., `aria-live="polite"`) placed inside the WebXR `dom-overlay`, using a `.sr-only` class to hide it visually.