## 2026-05-18 - WebXR DOM Overlay for Screen Reader Accessibility
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers. To provide accessible status updates, we need to synchronize 3D text changes to a visually hidden 2D HTML element with `aria-live` placed inside a WebXR `dom-overlay`.
**Action:** Always enable `dom-overlay` with a `pointer-events: none` container and use a `.sr-only` class on an `aria-live` region for WebXR accessibility without disrupting canvas interactions.
