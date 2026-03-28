## 2024-05-24 - Accessible Status Announcements in WebXR
**Learning:** In Three.js WebXR applications, 3D text meshes are not accessible to screen readers, leaving users unaware of critical state changes.
**Action:** Always implement a 2D HTML element with appropriate ARIA attributes (e.g., `role="status"`, `aria-live="polite"`) inside a `dom-overlay` configured via the `ARButton`'s `optionalFeatures` to ensure accessible status updates.
