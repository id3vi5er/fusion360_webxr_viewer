## 2023-10-27 - 3D Text Mesh Accessibility
**Learning:** In Three.js WebXR applications, 3D text meshes rendered in canvas are not accessible to screen readers, making status updates invisible to some users.
**Action:** To provide accessible status updates in WebXR, always implement a 2D HTML element with `aria-live` inside a `dom-overlay` configured via the `ARButton`'s `optionalFeatures`.
