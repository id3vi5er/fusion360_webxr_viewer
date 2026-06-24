## 2024-06-23 - Accessible WebXR Text
**Learning:** 3D text and canvas elements in WebXR cannot be read by screen readers.
**Action:** Synchronize 3D text to a visually hidden (`.sr-only`) `aria-live` region inside a WebXR `dom-overlay` container with `pointer-events: none` to make it accessible without blocking pointer interactions.
