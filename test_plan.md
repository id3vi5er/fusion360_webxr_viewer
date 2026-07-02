1. **Analyze `addin/www/index.html`**
   - Examine how Three.js and WebXR are currently configured.
   - Note the usage of `updateDebugText` that renders visual text to a 3D canvas mesh.
2. **Implement DOM Overlay and ARIA Live Region**
   - Add a `<div id="ar-overlay" style="pointer-events: none;">` to the body.
   - Inside it, add a visually hidden `<div id="aria-status" aria-live="polite" style="...">` to act as an ARIA live region.
   - Update the `ARButton.createButton` call to include `optionalFeatures: ['dom-overlay']` and `domOverlay: { root: document.getElementById('ar-overlay') }`.
   - Update `updateDebugText` to also set the `textContent` of the `#aria-status` element, keeping the screen reader synchronized with the visual 3D text.
3. **Verify Changes**
   - Ensure the HTML syntax is correct.
   - Serve the application locally and check for any console errors.
4. **Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.**
5. **Submit PR**
   - Title: `🎨 Palette: Make WebXR debug text accessible`
   - Description including What, Why, Before/After, and Accessibility.
