## 2024-05-28 - Accessible WebXR Status Updates
**Learning:** In Three.js WebXR applications, 3D text meshes (like the debug panel) are not accessible to screen readers. For accessible status updates (e.g., "Lade Materialien...", "Modell geladen"), a 2D HTML element with appropriate ARIA attributes must be implemented.
**Action:** When providing status updates in WebXR, always implement a 2D HTML element with `role="status"` and `aria-live="polite"` inside a `dom-overlay` configured via the `ARButton`'s `optionalFeatures`, ensuring it works alongside any 3D visual text.
