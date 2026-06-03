## 2024-06-03 - Accessible 3D Text in WebXR
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers. To provide accessible status updates, 3D text changes must be synchronized to a 2D HTML element with ARIA attributes (e.g., `aria-live="polite"`) placed inside the WebXR `dom-overlay`.
**Action:** When adding 3D text or debug text to WebXR applications, always set up a `dom-overlay` and mirror the text updates to a visually hidden (`.sr-only`) live region to ensure screen reader users receive the same status updates.
