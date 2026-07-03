## 2024-07-04 - WebXR Accessibility via DOM Overlay
**Learning:** 3D text in WebXR is completely invisible to screen readers. We must use a `dom-overlay` to synchronize text to an accessible 2D DOM element (e.g. `aria-live="polite"`). The root of the DOM overlay must not be `display: none` but should have `pointer-events: none` to avoid blocking interactions.
**Action:** Always enable `dom-overlay` in ARButton and maintain a `.sr-only` ARIA live region inside it to narrate 3D visual changes to screen readers in WebXR.
