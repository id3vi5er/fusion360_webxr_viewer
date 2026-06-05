## 2024-05-24 - Accessible WebXR Status Updates
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers, leaving users relying on assistive technology unaware of critical state updates.
**Action:** Always implement a WebXR `dom-overlay` (with `pointer-events: none;`) to synchronize 3D text changes to a visually hidden 2D HTML element with an `aria-live` region (`.sr-only`), ensuring updates are announced without breaking immersion.
