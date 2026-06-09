## 2024-05-20 - WebXR Status Updates Accessibility
**Learning:** 3D text meshes in WebXR (like canvas textures on planes) are inherently inaccessible to screen readers, making status updates invisible to assistive technologies.
**Action:** Always enable `dom-overlay` in WebXR and synchronize status changes to a visually hidden (`.sr-only`) HTML element with `aria-live="polite"` to ensure screen readers can announce state changes during an AR session.
