## 2024-05-15 - WebXR 3D Text Accessibility
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers. To provide accessible status updates, synchronize 3D text changes to a 2D HTML element with ARIA attributes (e.g., `aria-live="polite"`) placed inside the WebXR `dom-overlay`.
**Action:** When implementing status or notification systems in WebXR, always pair the 3D visual text with a visually hidden, `aria-live` 2D DOM element within a `dom-overlay` to ensure screen reader users receive the same updates.
