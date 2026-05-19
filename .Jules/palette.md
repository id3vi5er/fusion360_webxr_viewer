## 2026-05-19 - WebXR Screen Reader Inaccessibility
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers. To provide accessible status updates, synchronize 3D text changes to a 2D HTML element with ARIA attributes (e.g., `aria-live="polite"`) placed inside the WebXR `dom-overlay`. The root element must not have `style="display: none;"` and should use `pointer-events: none;`.
**Action:** When building WebXR experiences with status text, always configure an ARButton `dom-overlay` and sync the text updates to an `.sr-only` aria-live region inside it.
