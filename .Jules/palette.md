## 2026-03-19 - WebXR 3D Text Accessibility

**Learning:** 3D text meshes in WebXR (like Three.js meshes) are completely invisible to screen readers, making status updates or critical information inaccessible in AR/VR sessions.

**Action:** Always implement a synchronized 2D `dom-overlay` with ARIA live regions (`role="status"`, `aria-live="polite"`) for any dynamic 3D text or status updates in WebXR to ensure full accessibility.
