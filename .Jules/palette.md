## 2024-05-18 - Accessible WebXR Status Notifications
**Learning:** 3D text meshes in WebXR canvases are invisible to screen readers, making status updates entirely inaccessible.
**Action:** Always implement a 2D HTML element with appropriate ARIA attributes (e.g., `role="status" aria-live="polite"`) inside a `dom-overlay` configured via the `ARButton` to provide accessible state changes alongside 3D text.
