## 2024-05-15 - WebXR Screen Reader Support
**Learning:** 3D text meshes in WebXR are not accessible to screen readers.
**Action:** Always implement a 2D HTML element with appropriate ARIA attributes (like `aria-live="polite"`) inside a `dom-overlay` configured via `ARButton` to provide accessible status updates.
