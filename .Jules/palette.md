## 2024-05-24 - [WebXR 3D Text Accessibility]
**Learning:** 3D text meshes in WebXR are completely inaccessible to screen readers, preventing visually impaired users from receiving important status updates.
**Action:** Always synchronize 3D text updates to a visually hidden 2D HTML element with an `aria-live` attribute placed inside a WebXR `dom-overlay` to ensure screen reader compatibility.