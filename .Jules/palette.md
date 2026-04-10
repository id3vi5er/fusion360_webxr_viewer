## 2026-04-10 - WebXR Status Accessibility
**Learning:** 3D text (like Three.js TextGeometry or canvas planes) in WebXR is inherently inaccessible to screen readers.
**Action:** Always implement a 2D HTML element with appropriate ARIA attributes inside a `dom-overlay` (configured via ARButton's `optionalFeatures`) to provide accessible status updates.
