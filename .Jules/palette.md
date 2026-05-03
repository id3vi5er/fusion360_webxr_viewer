## 2024-05-03 - [WebXR DOM Overlay Accessibility]
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers. To provide accessible status updates, synchronize 3D text changes to a 2D HTML element with ARIA attributes (e.g., `aria-live="polite"`) placed inside the WebXR `dom-overlay`. The root element must not have `style="display: none;"` and should have `pointer-events: none;` to not block interaction.
**Action:** Use a `.sr-only` ARIA live region inside a WebXR `dom-overlay` to mirror 3D status text.
