## 2024-05-28 - [WebXR 3D Text Accessibility]
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers, meaning status updates only rendered in 3D are hidden from users relying on assistive technology.
**Action:** Synchronize 3D text changes to a visually hidden (`.sr-only`) 2D HTML element with `aria-live="polite"` inside a WebXR `dom-overlay` to ensure accessibility.
