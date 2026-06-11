## 2024-05-24 - Accessible 3D Text in WebXR
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers.
**Action:** Always synchronize 3D status text changes to a 2D HTML element with ARIA attributes (e.g., `aria-live="polite"`) placed inside the WebXR `dom-overlay`. Make sure the overlay container doesn't block pointers by using `pointer-events: none;`, and hide the text visually using the `.sr-only` utility class.
