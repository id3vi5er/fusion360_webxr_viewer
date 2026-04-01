## 2024-05-24 - Accessible Status Updates in WebXR
**Learning:** 3D text meshes (like the debug panel) in WebXR applications are completely invisible to screen readers.
**Action:** For accessible status updates in WebXR, always implement a 2D HTML element with appropriate ARIA attributes (like `role="status"` and `aria-live="polite"`) inside a `dom-overlay` configured via the `ARButton`'s `optionalFeatures`. This ensures screen reader users receive important state changes.
