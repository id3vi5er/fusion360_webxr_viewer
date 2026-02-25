# Fusion 360 to WebXR (AR/VR) Streaming (Standalone Add-in)

<div align="center">
  <img src="assets/icon.png" alt="Fusion 360 to WebXR Icon" width="128">

  <p>
    <a href="https://github.com/id3vi5er/fusion360_webxr_viewer/actions"><img src="https://img.shields.io/badge/build-passing-brightgreen" alt="Build Status"></a>
    <a href="https://github.com/id3vi5er/fusion360_webxr_viewer/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
    <a href="#"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20Mac-lightgrey" alt="Platform"></a>
    <a href="#"><img src="https://img.shields.io/badge/fusion%20360-api-orange" alt="Fusion 360 API"></a>
  </p>

  <p>
    <b>Export 3D models from Fusion 360 and visualize them instantly in Augmented Reality (Passthrough) on the Meta Quest 3 using WebXR.</b>
  </p>
</div>

---

This project is a **standalone Fusion 360 Add-in** that handles the entire pipeline: it exports the active design as an OBJ file and hosts a local HTTPS server directly within Fusion 360. No external Python servers or complex setups are required during daily use.

## 📂 Project Structure

*   **`addin/`**: The complete Fusion 360 Add-in.
    *   `FusionToWebXR.py`: Main logic (Export + Server + UI).
    *   `FusionToWebXR.manifest`: Metadata.
    *   `www/`: Web assets (HTML, JS) and exported models.
    *   `resources/`: Icons for the UI commands.
*   **`gen_cert.py`**: Helper script to generate self-signed SSL certificates using `trustme` (requires external Python).
*   **`requirements.txt`**: Python dependencies for the certificate generator.

## 🚀 Installation & Usage

### 1. Install Dependencies (One-time Setup)
WebXR requires a Secure Context (HTTPS). Since Fusion's internal Python environment is restricted, you must generate SSL certificates externally **once**.

1.  Ensure you have Python installed on your system.
2.  Install the required library (`trustme`):
    ```bash
    pip install -r requirements.txt
    ```
3.  Run the generator script in the project root:
    ```bash
    python gen_cert.py
    ```
    This will create `cert.pem` and `key.pem` inside the `addin/` folder.

### 2. Install the Add-in in Fusion 360
1.  Copy the `addin/` folder to your Fusion 360 Add-ins directory:
    *   **Windows:** `%AppData%\Autodesk\Autodesk Fusion 360\API\AddIns\`
    *   **Mac:** `~/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns/`
2.  (Optional) You can rename the folder to `FusionToWebXR` for clarity.

### 3. Run the Add-in
1.  Open Fusion 360.
2.  Go to **Utilities** > **Scripts and Add-Ins**.
3.  Select the **Add-Ins** tab.
4.  If you don't see "FusionToWebXR", click the green `+` icon and select the folder you just copied.
5.  Select "FusionToWebXR (Standalone)" and click **Run**.

## 🎮 Workflow

### 1. Start the Server
*   Go to the **Utilities** tab in the main toolbar.
*   Locate the **WebXR Streamer** panel.
*   Click **WebXR Server Starten**.
*   A popup will display the available URLs (e.g., `https://192.168.1.50:8000`).

### 2. Open in Quest 3
*   Put on your Meta Quest 3 headset.
*   Open the **Meta Quest Browser**.
*   Navigate to the URL displayed in Fusion (use the IP address, not localhost).
*   **Security Warning:** Since the certificate is self-signed, the browser will warn you. Click **"Advanced"** -> **"Proceed to ... (unsafe)"**.
*   Once loaded, click **"Start AR"** to enter passthrough mode.

### 3. Export Model
*   Open your design in Fusion 360.
*   Click **WebXR Export** in the panel.
*   The model in the headset will update automatically (the web app polls for changes).

## 🛠️ Development

*   **Frontend:** `addin/www/index.html` (Vanilla JS + Three.js). No build step required.
*   **Backend:** Python `http.server` wrapped in `ssl` (implemented in `FusionToWebXR.py`).
*   **Icons:** `addin/resources/` (PNGs).
