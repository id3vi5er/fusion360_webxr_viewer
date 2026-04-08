## 2025-04-08 - Accessible WebXR Status Updates
**Learning:** 3D text meshes in WebXR are not accessible to screen readers. For users to perceive status changes in immersive experiences, AR applications must use DOM overlays (`<div role="status" aria-live="polite">`) configured via `ARButton` features.
**Action:** Always implement a 2D HTML element with appropriate ARIA attributes inside a `dom-overlay` when status updates are needed in WebXR scenes, replacing or supplementing 3D text.
