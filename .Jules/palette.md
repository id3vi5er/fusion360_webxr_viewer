## 2024-03-14 - WebXR Accessible 2D Overlay
**Learning:** 3D text meshes in WebXR are completely inaccessible to screen readers. Placing a 2D HTML container with `role="status"` and `aria-live="polite"` inside a WebXR `dom-overlay` root allows for crucial status updates (like toast notifications) to be read by assistive technologies while presenting in AR.
**Action:** Always implement a 2D DOM fallback with proper ARIA attributes for any textual feedback in WebXR experiences, utilizing the `optionalFeatures: ['dom-overlay']` when initializing the AR session.
