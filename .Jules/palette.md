## 2026-07-02 - WebXR Accessibility with DOM Overlays
**Learning:** 3D text in WebXR is inherently inaccessible to screen readers. We can use `dom-overlay` to layer a visually hidden (`.sr-only`) HTML container with `aria-live="polite"` over the WebXR canvas, keeping it synchronized with the 3D text. Crucially, the root overlay must not have `display: none` and must have `pointer-events: none` to avoid blocking interactions.
**Action:** Whenever implementing 3D text feedback in WebXR, always pair it with a synchronized, visually hidden `aria-live` region in a `dom-overlay`.
