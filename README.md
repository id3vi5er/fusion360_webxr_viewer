# Fusion 360 to WebXR (AR/VR) Streaming (Standalone Add-in)

<div align="center">
  <img src="assets/icon.png" alt="Fusion 360 to WebXR Icon" width="128">
</div>

This project is a **standalone Fusion 360 Add-in** that exports 3D models and hosts them on a local HTTPS server directly within Fusion 360, enabling visualization in Augmented Reality (Passthrough) on the Meta Quest 3 via WebXR.

## 📂 Project Structure

*   **`addin/`**: The complete Fusion 360 Add-in.
    *   `FusionToWebXR.py`: Main logic (Export + Server + UI).
    *   `FusionToWebXR.manifest`: Metadata.
    *   `www/`: Web assets (HTML, JS) and exported models.
    *   `resources/`: Icons for the UI commands.
*   **`gen_cert.py`**: Helper script to generate self-signed SSL certificates using `trustme` (requires external Python).

## 🚀 Installation & Usage

### 1. Install the Add-in
1.  Copy the `addin/` folder to your Fusion 360 Add-ins directory:
    *   **Windows:** `%AppData%\Autodesk\Autodesk Fusion 360\API\AddIns\`
    *   **Mac:** `~/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns/`
2.  (Optional) Rename the folder to `FusionToWebXR` if you prefer.

### 2. Generate SSL Certificates (Important!)
WebXR requires a Secure Context (HTTPS). Since Fusion's Python environment is restricted, you must generate certificates externally once.

1.  Ensure you have Python installed on your system.
2.  Install `trustme`:
    ```bash
    pip install trustme
    ```
3.  Run the generator script in the project root:
    ```bash
    python gen_cert.py
    ```
    This will create `cert.pem` and `key.pem` inside the `addin/` folder.

### 3. Run in Fusion 360
1.  Open Fusion 360.
2.  Go to **Utilities** > **Scripts and Add-Ins**.
3.  Select the **Add-Ins** tab.
4.  If you don't see "FusionToWebXR", click the green `+` and select the folder.
5.  Select "FusionToWebXR (Standalone)" and click **Run**.

### 4. Workflow
1.  **Start Server:**
    *   Go to the **Utilities** tab.
    *   Locate the **WebXR Streamer** panel.
    *   Click **WebXR Server Starten**.
    *   Note the IP address (e.g., `https://192.168.1.50:8000`).
2.  **Open in Quest 3:**
    *   Open the Meta Quest Browser.
    *   Navigate to the URL.
    *   **Accept the warning:** Click "Advanced" -> "Proceed to ... (unsafe)".
    *   Enter VR/AR mode.
3.  **Export Model:**
    *   Open your design in Fusion 360.
    *   Click **WebXR Export** in the panel.
    *   The model in the headset will update automatically (refresh usually not needed, logic handles it).

## 🛠️ Development

*   **Frontend:** `addin/www/index.html` (Vanilla JS + Three.js).
*   **Backend:** Python `http.server` wrapped in `ssl` (inside `FusionToWebXR.py`).
*   **Icons:** `addin/resources/` (PNGs).

## License
MIT
