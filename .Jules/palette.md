## 2026-03-10 - WebXR 3D Text Accessibility
**Learning:** 3D text rendered in a WebGL/WebXR canvas is completely invisible to screen readers, making status updates or instructions inaccessible. The standard ARButton must be extended to support 'dom-overlay'.
**Action:** Always mirror critical 3D text (like status indicators) to a 2D DOM overlay positioned over the WebXR canvas, using `role="status"` and `aria-live="polite"` to ensure screen readers announce the updates dynamically.
