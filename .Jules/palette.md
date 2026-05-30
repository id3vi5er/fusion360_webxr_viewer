## 2024-05-30 - Accessible 3D Text in WebXR
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers, hiding important application states.
**Action:** Use a `dom-overlay` container with `pointer-events: none` and a visually hidden (`.sr-only`) `aria-live` region to synchronize 3D text updates for screen readers.