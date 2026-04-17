## 2024-05-15 - WebXR 3D Text Accessibility
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers because they exist within the WebGL canvas, which is opaque to assistive technologies.
**Action:** Synchronize important status changes from 3D text meshes to a visually hidden 2D HTML element with ARIA attributes (e.g., `aria-live="polite"`) placed inside the WebXR `dom-overlay`.
