## 2024-05-24 - WebXR Screen Reader Accessibility
**Learning:** 3D text meshes in WebXR are inherently inaccessible to screen readers.
**Action:** Always synchronize 3D text status updates to a 2D HTML element with `aria-live` attributes placed inside a WebXR `dom-overlay` to ensure screen readers can announce status changes.
