## 2024-07-06 - Accessible 3D Text in WebXR
**Learning:** 3D text rendered via Three.js (like debug panels) is invisible to screen readers in WebXR.
**Action:** Use a WebXR `dom-overlay` containing a visually hidden `.sr-only` element with `aria-live="polite"` and synchronize the 3D text content to this DOM element to ensure accessibility.
