## 2024-05-24 - Accessible Status Updates in WebXR
**Learning:** In Three.js WebXR applications, 3D text meshes (like the debug mesh used for status updates) are completely inaccessible to screen readers. Relying solely on them means visually impaired users receive no status feedback.
**Action:** When implementing status updates or notifications in WebXR, always use a `dom-overlay` with a 2D HTML container. Set `role="status"` and `aria-live="polite"` on the status element to ensure screen readers announce the updates while in the AR session.
