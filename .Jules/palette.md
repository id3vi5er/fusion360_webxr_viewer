## 2024-05-24 - WebXR Accessibility with DOM Overlays
**Learning:** 3D text meshes in WebXR are completely invisible to screen readers. To make state changes accessible, you must synchronize text to a visually hidden (`.sr-only`) ARIA live region inside a configured `dom-overlay`. The root element of the overlay must NOT have `display: none;` as it breaks the accessibility tree, but SHOULD have `pointer-events: none;` to avoid blocking interactions.
**Action:** Always include a DOM overlay with an ARIA live region for WebXR applications that rely on 3D text for critical status feedback.
