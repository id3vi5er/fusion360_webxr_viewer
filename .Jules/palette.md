## 2026-03-15 - WebXR 3D Text is Inaccessible
**Learning:** In Three.js WebXR applications, 3D text meshes (like those used for debug/status panels) are completely invisible to screen readers, making critical state updates inaccessible.
**Action:** Always implement a 2D HTML element with appropriate ARIA attributes (e.g., `role="status"`, `aria-live="polite"`) inside a `dom-overlay` container mapped via the `ARButton`'s `optionalFeatures`. This ensures status changes are properly announced.
