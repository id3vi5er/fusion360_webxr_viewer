## 2024-11-20 - WebXR 3D Text Accessibility
**Learning:** 3D text in WebXR is inherently inaccessible to screen readers. Creating a visually hidden `aria-live` region within a `dom-overlay` effectively synchronizes 3D state changes to assistive technologies without breaking immersion.
**Action:** Always include an accessible DOM overlay with an `aria-live` announcer region when displaying status updates or debug text in WebXR environments.
