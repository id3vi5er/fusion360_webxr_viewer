## 2026-03-30 - Accessible Status Updates in WebXR
**Learning:** 3D text meshes in Three.js WebXR applications are completely inaccessible to screen readers and difficult to style responsively.
**Action:** Always implement a 2D HTML element with appropriate ARIA attributes (like `role="status"` and `aria-live="polite"`) inside a `dom-overlay` configured via the ARButton's optionalFeatures for accessible and responsive status notifications.
