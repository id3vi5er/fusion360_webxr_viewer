## 2024-05-24 - WebXR Status Announcements

**Learning:** 3D text meshes within WebXR scenes are entirely inaccessible to screen readers, meaning users who rely on assistive technologies receive no status updates (e.g., loading, grab states) during a WebXR session.
**Action:** Always use the WebXR `dom-overlay` feature in combination with ARIA `role="status"` and `aria-live="polite"` to project a 2D DOM element over the 3D scene. This provides accessible status announcements while maintaining visual context.
