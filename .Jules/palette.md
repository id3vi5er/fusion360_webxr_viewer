## 2024-07-01 - WebXR 3D Text Accessibility
**Learning:** 3D text rendered via CanvasTexture in WebXR is completely invisible to screen readers, leaving users blind to crucial state updates (like grab states or loading progress).
**Action:** Always enable `dom-overlay` in WebXR configurations and mirror dynamic 3D text into a visually hidden `aria-live` region within the overlay to ensure assistive technologies can read it.
