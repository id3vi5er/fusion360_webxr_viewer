## 2025-01-28 - Accessible Status Updates in WebXR
**Learning:** 3D text meshes in WebXR are not accessible to screen readers, making status updates invisible to assistive technology.
**Action:** Always implement a 2D HTML element with `role="status"` and `aria-live="polite"` inside a `dom-overlay` configured via the `ARButton` optional features.
