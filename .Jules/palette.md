## 2024-05-24 - WebXR 3D Text Accessibility
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers.
**Action:** Synchronize 3D text changes to a 2D HTML element with ARIA attributes (e.g., `aria-live="polite"`) placed inside the WebXR `dom-overlay`. Apply `pointer-events: none;` to the overlay container and use standard `.sr-only` CSS to visually hide the text while keeping it accessible.
