# Fusion 360 Addin: FusionToWebXR (Standalone)
# Combines Export + Local HTTPS Server

import adsk.core, adsk.fusion, traceback
import http.server
import ssl
import threading
import socket
import os
import sys

# Globale Variablen für Server und Threads
SERVER_THREAD = None
SERVER_HTTPD = None
SERVER_RUNNING = False
SERVER_PORT = 8000

# Pfade relativ zum Script
SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
WWW_DIR = os.path.join(SCRIPT_DIR, "www")
CERT_FILE = os.path.join(SCRIPT_DIR, "cert.pem")
KEY_FILE = os.path.join(SCRIPT_DIR, "key.pem")

# Fusion 360 UI IDs
CMD_START_ID = 'cmdStartServer_Standalone'
CMD_EXPORT_ID = 'cmdExportModel_Standalone'
PANEL_ID = 'pnlWebXR_Standalone'
TAB_ID = 'ToolsTab'

# -----------------------------------------------------------------------------
# HTTP Server Logic
# -----------------------------------------------------------------------------
class CORSSSLRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS for Quest access
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def translate_path(self, path):
        # Serve from 'www' directory instead of CWD
        path = super().translate_path(path)
        rel_path = os.path.relpath(path, os.getcwd())
        return os.path.join(WWW_DIR, rel_path)

def get_all_ips():
    ip_list = []
    try:
        # Get all network interfaces
        hostname = socket.gethostname()
        # Get all addresses for the hostname
        infos = socket.getaddrinfo(hostname, None, socket.AF_INET)
        
        for info in infos:
            ip = info[4][0]
            if ip != '127.0.0.1' and not ip.startswith('169.254'):
                if ip not in ip_list:
                    ip_list.append(ip)
        
        # Fallback if no real IP found
        if not ip_list:
            # Try the connection method as backup
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                s.connect(('10.255.255.255', 1))
                ip = s.getsockname()[0]
                if ip != '127.0.0.1':
                    ip_list.append(ip)
            except:
                pass
            finally:
                s.close()
                
        if not ip_list:
            ip_list.append('127.0.0.1')
            
    except Exception:
        ip_list = ['127.0.0.1']
        
    return ip_list

def server_worker():
    global SERVER_HTTPD, SERVER_RUNNING
    
    # Change CWD to WWW_DIR so SimpleHTTPRequestHandler serves correct files
    # Note: Changing CWD in a thread might be risky in Fusion, but translate_path handles it better usually.
    # We use a custom handler that overrides translate_path to be safe.
    
    handler = CORSSSLRequestHandler
    
    try:
        SERVER_HTTPD = http.server.HTTPServer(('0.0.0.0', SERVER_PORT), handler)
        
        # Wrap with SSL
        if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
            SERVER_HTTPD.socket = ctx.wrap_socket(SERVER_HTTPD.socket, server_side=True)
        else:
            app = adsk.core.Application.get()
            app.userInterface.messageBox("SSL Cert/Key missing! WebXR requires HTTPS.")
            return

        SERVER_RUNNING = True
        SERVER_HTTPD.serve_forever()
    except Exception as e:
        SERVER_RUNNING = False
        app = adsk.core.Application.get()
        if app:
            app.userInterface.messageBox(f"Server Error: {str(e)}")

def start_server_thread():
    global SERVER_THREAD, SERVER_RUNNING
    if SERVER_RUNNING:
        return
    
    SERVER_THREAD = threading.Thread(target=server_worker, daemon=True)
    SERVER_THREAD.start()

def stop_server_thread():
    global SERVER_HTTPD, SERVER_RUNNING
    if SERVER_HTTPD:
        SERVER_HTTPD.shutdown()
        SERVER_HTTPD.server_close()
        SERVER_HTTPD = None
    SERVER_RUNNING = False

# -----------------------------------------------------------------------------
# Fusion 360 Command Handlers
# -----------------------------------------------------------------------------
class StartServerCommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        app = adsk.core.Application.get()
        ui = app.userInterface
        try:
            if not SERVER_RUNNING:
                start_server_thread()
                
                ips = get_all_ips()
                msg = "Server gestartet!\n\nMögliche URLs:\n"
                for ip in ips:
                    msg += f"- https://{ip}:{SERVER_PORT}\n"
                
                msg += "\n(Zertifikat im Browser akzeptieren!)"
                
                ui.messageBox(msg)
            else:
                ips = get_all_ips()
                msg = "Server läuft bereits.\n\nMögliche URLs:\n"
                for ip in ips:
                    msg += f"- https://{ip}:{SERVER_PORT}\n"
                    
                ui.messageBox(msg)
        except:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

class StopServerCommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        app = adsk.core.Application.get()
        ui = app.userInterface
        try:
            if SERVER_RUNNING:
                stop_server_thread()
                ui.messageBox("Server gestoppt.")
            else:
                ui.messageBox("Server läuft nicht.")
        except:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

class ExportCommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        app = adsk.core.Application.get()
        ui = app.userInterface
        try:
            design = adsk.fusion.Design.cast(app.activeProduct)
            if not design:
                ui.messageBox('Kein aktives Design.')
                return

            # Ensure directory exists
            if not os.path.exists(WWW_DIR):
                os.makedirs(WWW_DIR)

            base_name = "model"
            obj_path = os.path.join(WWW_DIR, base_name + ".obj")
            mtl_path = os.path.join(WWW_DIR, base_name + ".mtl")

            # Cleanup old files
            if os.path.exists(obj_path): os.remove(obj_path)
            if os.path.exists(mtl_path): os.remove(mtl_path)

            # Export
            export_mgr = design.exportManager
            options = export_mgr.createOBJExportOptions(design.rootComponent, obj_path)
            success = export_mgr.execute(options)
            
            if success:
                ui.messageBox("Export erfolgreich!\nModell im Browser aktualisieren.")
            else:
                ui.messageBox("Export fehlgeschlagen.")

        except:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

class CommandCreatedEventHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self, handler_cls):
        super().__init__()
        self.handler_cls = handler_cls
    def notify(self, args):
        try:
            cmd = args.command
            onExecute = self.handler_cls()
            cmd.execute.add(onExecute)
            # Keep the handler referenced to prevent GC
            _handlers.append(onExecute)
        except:
            app = adsk.core.Application.get()
            app.userInterface.messageBox('Failed:\n{}'.format(traceback.format_exc()))

# Keep handlers in memory
_handlers = []

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface

        # 1. Create Controls
        cmdDefs = ui.commandDefinitions
        
        # Define path to resources
        RESOURCES = os.path.join(SCRIPT_DIR, 'resources')
        
        # Start Server Button
        cmdStart = cmdDefs.itemById(CMD_START_ID)
        if not cmdStart:
            cmdStart = cmdDefs.addButtonDefinition(
                CMD_START_ID, 
                'WebXR Server Starten', 
                'Startet lokalen HTTPS Server für Quest 3', 
                os.path.join(RESOURCES, 'cmdStartServer_Standalone')
            )
        
        # Export Button
        cmdExport = cmdDefs.itemById(CMD_EXPORT_ID)
        if not cmdExport:
            cmdExport = cmdDefs.addButtonDefinition(
                CMD_EXPORT_ID, 
                'WebXR Export', 
                'Exportiert aktuelles Modell für WebXR', 
                os.path.join(RESOURCES, 'cmdExportModel_Standalone')
            )

        # Connect Handlers
        onStartCreated = CommandCreatedEventHandler(StartServerCommandExecuteHandler)
        cmdStart.commandCreated.add(onStartCreated)
        _handlers.append(onStartCreated)

        onExportCreated = CommandCreatedEventHandler(ExportCommandExecuteHandler)
        cmdExport.commandCreated.add(onExportCreated)
        _handlers.append(onExportCreated)

        # Add to UI (Tools Tab -> Add-Ins Panel is easiest, or create custom)
        # We will add to the "Utilities" tab (Tools) under a new panel "WebXR"
        all_workspaces = ui.workspaces
        # Try to find Design workspace
        design_ws = all_workspaces.itemById('FusionSolidEnvironment')
        
        if design_ws:
            # Create Panel
            tabs = design_ws.toolbarTabs
            tools_tab = tabs.itemById(TAB_ID)
            if tools_tab:
                panels = tools_tab.toolbarPanels
                xr_panel = panels.itemById(PANEL_ID)
                if not xr_panel:
                    xr_panel = panels.add(PANEL_ID, 'WebXR Streamer', 'SelectPanel', False)
                
                # Add Controls
                xr_panel.controls.addCommand(cmdStart)
                xr_panel.controls.addCommand(cmdExport)

    except:
        if ui:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

def stop(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        
        # Stop Server
        stop_server_thread()

        # Clean UI
        cmdDefs = ui.commandDefinitions
        
        # Remove Panel
        design_ws = ui.workspaces.itemById('FusionSolidEnvironment')
        if design_ws:
            tools_tab = design_ws.toolbarTabs.itemById(TAB_ID)
            if tools_tab:
                panel = tools_tab.toolbarPanels.itemById(PANEL_ID)
                if panel:
                    panel.deleteMe()

        # Remove Commands
        cmdStart = cmdDefs.itemById(CMD_START_ID)
        if cmdStart: cmdStart.deleteMe()
        
        cmdExport = cmdDefs.itemById(CMD_EXPORT_ID)
        if cmdExport: cmdExport.deleteMe()

    except:
        if ui:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))
