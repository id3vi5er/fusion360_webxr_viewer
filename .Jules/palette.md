## 2024-04-28 - WebXR DOM Overlay Initialization
**Learning:** In WebXR scenes created with Three.js, elements that convey status or accessibility information (like standard ARIA live regions) need a `dom-overlay` mechanism to be accessible during a VR/AR session. Standard 3D meshes for text are not readable by screen readers.
**Action:** When adding accessibility features to WebXR projects, always enable the DOM overlay feature in the WebXR button initialization and place the ARIA live regions in the specified overlay root.
