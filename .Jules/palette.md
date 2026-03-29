## 2024-03-29 - WebXR 3D Text Accessibility
**Learning:** In Three.js WebXR applications, 3D text meshes are completely invisible to screen readers, creating a major accessibility barrier for status updates and feedback.
**Action:** Always implement a 2D HTML element with appropriate ARIA attributes (e.g. `role="status" aria-live="polite"`) inside a `dom-overlay` configured via the `ARButton`'s `optionalFeatures`. Ensure the root overlay has `pointer-events: none` to allow canvas interaction while interactive elements have `pointer-events: auto`.
