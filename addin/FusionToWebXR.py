# Fusion 360 Addin: FusionToWebXR (Standalone)
# Combines Export + Local HTTPS Server

import adsk.core, adsk.fusion, traceback
import functools
import http.server
import importlib
import json
import os
import shutil
import socket
import ssl
import threading
import time

from . import glb_export
importlib.reload(glb_export)  # Änderungen am Modul beim Neustart des Add-ins übernehmen

# Globale Variablen für Server und Threads
SERVER_THREAD = None
SERVER_HTTPD = None
SERVER_PORT = 8000

# Pfade relativ zum Script
SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
WWW_DIR = os.path.join(SCRIPT_DIR, "www")
CERT_FILE = os.path.join(SCRIPT_DIR, "cert.pem")
KEY_FILE = os.path.join(SCRIPT_DIR, "key.pem")
SETTINGS_FILE = os.path.join(SCRIPT_DIR, "settings.json")

# Fusion 360 UI IDs
CMD_START_ID = 'cmdStartServer_Standalone'
CMD_STOP_ID = 'cmdStopServer_Standalone'
CMD_EXPORT_ID = 'cmdExportModel_Standalone'
CMD_SETTINGS_ID = 'cmdSettings_Standalone'
PANEL_ID = 'pnlWebXR_Standalone'
TAB_ID = 'ToolsTab'
AUTO_EXPORT_EVENT_ID = 'FusionToWebXR_AutoExport'

# Auto-Export: so lange nach dem letzten abgeschlossenen Befehl warten
AUTO_EXPORT_DELAY = 1.5
SSE_HEARTBEAT = 15

DEFAULT_SETTINGS = {'format': 'glb', 'quality': 'normal', 'autoExport': True}
QUALITY_LABELS = [('low', 'Grob'), ('normal', 'Normal'), ('high', 'Fein'), ('veryhigh', 'Sehr fein')]
FORMAT_LABELS = [('glb', 'GLB (Bauteilbaum, Materialien, 1:1)'), ('obj', 'OBJ (Fusion-Export, Rückfall)')]


# -----------------------------------------------------------------------------
# Einstellungen
# -----------------------------------------------------------------------------
_settings = None

def load_settings():
    global _settings
    if _settings is None:
        _settings = dict(DEFAULT_SETTINGS)
        try:
            with open(SETTINGS_FILE, encoding='utf-8') as f:
                _settings.update(json.load(f))
        except Exception:
            pass
    return _settings


def save_settings(settings):
    global _settings
    _settings = dict(DEFAULT_SETTINGS, **settings)
    with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
        json.dump(_settings, f, indent=1)


def log(text):
    # Ins Textbefehle-Fenster von Fusion statt Dialoge beim Auto-Export
    try:
        palette = adsk.core.Application.get().userInterface.palettes.itemById('TextCommands')
        if palette:
            palette.writeText('[WebXR] ' + text)
    except Exception:
        pass


# -----------------------------------------------------------------------------
# Server-Sent Events: Fusion meldet neue Exporte direkt an die Brille
# -----------------------------------------------------------------------------
_sse_cond = threading.Condition()
_sse_state = {'seq': 0, 'event': None, 'data': '{}', 'stopping': False}


def broadcast(event, data):
    """Thread-sicher; verbundene Clients erhalten nur das jeweils neueste Ereignis."""
    with _sse_cond:
        _sse_state['seq'] += 1
        _sse_state['event'] = event
        _sse_state['data'] = json.dumps(data, ensure_ascii=False)
        _sse_cond.notify_all()


# -----------------------------------------------------------------------------
# HTTP Server Logic
# -----------------------------------------------------------------------------
class CORSSSLRequestHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.json': 'application/json',
        '.glb': 'model/gltf-binary',
        '.obj': 'text/plain',
        '.mtl': 'text/plain',
    }

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

    def do_GET(self):
        if self.path.split('?')[0] == '/events':
            self.serve_events()
        else:
            super().do_GET()

    def serve_events(self):
        self.close_connection = True
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        with _sse_cond:
            seq = _sse_state['seq']
        try:
            self.wfile.write(b'retry: 2000\n\n')
            self.wfile.flush()
            while True:
                with _sse_cond:
                    _sse_cond.wait_for(lambda: _sse_state['seq'] != seq or _sse_state['stopping'], timeout=SSE_HEARTBEAT)
                    if _sse_state['stopping']:
                        return
                    changed = _sse_state['seq'] != seq
                    seq = _sse_state['seq']
                    event, data = _sse_state['event'], _sse_state['data']
                # Ohne Änderung ein Kommentar als Heartbeat, damit tote Verbindungen auffallen
                msg = f'event: {event}\ndata: {data}\n\n' if changed else ': ping\n\n'
                self.wfile.write(msg.encode('utf-8'))
                self.wfile.flush()
        except (OSError, ssl.SSLError):
            pass  # Brille hat die Verbindung geschlossen

    def log_message(self, format, *args):
        # Die Brille fragt regelmäßig nach – kein Log-Rauschen in Fusion
        pass


class ExclusiveHTTPServer(http.server.ThreadingHTTPServer):
    # Unter Windows erlaubt SO_REUSEADDR einen zweiten Bind auf denselben Port –
    # dann würde ein belegter Port nicht erkannt
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


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


def start_server():
    """Bindet den Server im Hauptthread, damit Fehler direkt gemeldet werden können.

    Gibt None bei Erfolg zurück, sonst eine Fehlermeldung.
    """
    global SERVER_THREAD, SERVER_HTTPD
    if SERVER_HTTPD:
        return None

    if not (os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE)):
        return ("SSL-Zertifikat fehlt (cert.pem / key.pem im Add-in-Ordner).\n"
                "WebXR braucht HTTPS – bitte gen_cert.py ausführen.")

    handler = functools.partial(CORSSSLRequestHandler, directory=WWW_DIR)
    try:
        httpd = ExclusiveHTTPServer(('0.0.0.0', SERVER_PORT), handler)
    except OSError as e:
        return f"Port {SERVER_PORT} ist nicht verfügbar ({e.strerror or e})."

    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    except Exception as e:
        httpd.server_close()
        return f"Zertifikat konnte nicht geladen werden: {e}"

    httpd.daemon_threads = True
    with _sse_cond:
        _sse_state['stopping'] = False
    SERVER_HTTPD = httpd
    # Der Thread fasst die Fusion-API nicht an – Fehler dort würden sonst Fusion destabilisieren
    SERVER_THREAD = threading.Thread(target=httpd.serve_forever, daemon=True)
    SERVER_THREAD.start()
    return None


def stop_server():
    global SERVER_HTTPD, SERVER_THREAD
    cancel_auto_export()
    if SERVER_HTTPD:
        # Offene SSE-Verbindungen beenden, sonst hängen deren Threads bis zum nächsten Heartbeat
        with _sse_cond:
            _sse_state['stopping'] = True
            _sse_cond.notify_all()
        SERVER_HTTPD.shutdown()
        SERVER_HTTPD.server_close()
        SERVER_HTTPD = None
    SERVER_THREAD = None


def url_list():
    return "".join(f"- https://{ip}:{SERVER_PORT}\n" for ip in get_all_ips())


# -----------------------------------------------------------------------------
# Export
# -----------------------------------------------------------------------------
def export_obj(design):
    # In einen Unterordner exportieren und dann verschieben, damit die Brille
    # nie halb geschriebene Dateien sieht (mtllib-Verweis bleibt "model.mtl")
    tmp_dir = os.path.join(WWW_DIR, '_export_tmp')
    shutil.rmtree(tmp_dir, ignore_errors=True)
    os.makedirs(tmp_dir)
    try:
        export_mgr = design.exportManager
        options = export_mgr.createOBJExportOptions(design.rootComponent, os.path.join(tmp_dir, 'model.obj'))
        if not export_mgr.execute(options):
            return None
        mtl_tmp = os.path.join(tmp_dir, 'model.mtl')
        mtl_path = os.path.join(WWW_DIR, 'model.mtl')
        if os.path.exists(mtl_tmp):
            os.replace(mtl_tmp, mtl_path)
        elif os.path.exists(mtl_path):
            os.remove(mtl_path)
        os.replace(os.path.join(tmp_dir, 'model.obj'), os.path.join(WWW_DIR, 'model.obj'))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    app = adsk.core.Application.get()
    meta = {
        'version': int(os.path.getmtime(os.path.join(WWW_DIR, 'model.obj')) * 1000),
        'format': 'obj',
        'file': 'model.obj',
        'document': app.activeDocument.name if app.activeDocument else None,
        'units': 'cm',
        'hasMtl': os.path.exists(os.path.join(WWW_DIR, 'model.mtl')),
    }
    glb_export.write_scene_json(WWW_DIR, meta)
    return meta


def run_export(design, settings):
    """Exportiert und meldet das Ergebnis per SSE. Fehler werden weitergereicht."""
    broadcast('exporting', {})
    try:
        if settings.get('format') == 'obj':
            meta = export_obj(design)
        else:
            meta = glb_export.export_design(design, WWW_DIR, settings.get('quality', 'normal'))
    except Exception as e:
        broadcast('exporterror', {'message': f'Export fehlgeschlagen: {e}'})
        raise
    if meta:
        _auto['fingerprint'] = design_fingerprint(design)
        broadcast('scene', {'version': meta['version']})
    else:
        broadcast('exporterror', {'message': 'Export fehlgeschlagen'})
    return meta


# -----------------------------------------------------------------------------
# Auto-Export
# -----------------------------------------------------------------------------
# Ablauf: Befehl abgeschlossen -> Timer (Entprellung) -> Custom Event -> Export im
# Hauptthread, aber nur, wenn sich der Fingerabdruck des Designs geändert hat
_auto = {'timer': None, 'fingerprint': None, 'event': None}


def design_fingerprint(design):
    """Billiger Vergleichswert: sichtbare Körper mit Darstellung, Volumen, Fläche und Hüllquader.

    Fängt auch Parameteränderungen ab, die weder Timeline noch Hüllquader verändern.
    """
    parts = [design.parentDocument.name if design.parentDocument else '']
    for occ_bodies in _visible_body_lists(design.rootComponent):
        for body in occ_bodies:
            if not body.isVisible:
                continue
            bb = body.boundingBox
            parts.append((body.entityToken, glb_export.appearance_key(body.appearance),
                          round(body.volume, 7), round(body.area, 6), body.faces.count,
                          tuple(round(v, 5) for v in (bb.minPoint.x, bb.minPoint.y, bb.minPoint.z,
                                                      bb.maxPoint.x, bb.maxPoint.y, bb.maxPoint.z))))
    return hash(tuple(parts))


def _visible_body_lists(root):
    yield root.bRepBodies
    for occ in root.allOccurrences:
        if occ.isVisible:
            yield occ.bRepBodies


def schedule_auto_export():
    if not (SERVER_HTTPD and load_settings().get('autoExport')):
        return
    cancel_auto_export()
    # fireCustomEvent ist thread-sicher; der Export selbst läuft dann im Hauptthread
    timer = threading.Timer(AUTO_EXPORT_DELAY, lambda: adsk.core.Application.get().fireCustomEvent(AUTO_EXPORT_EVENT_ID, ''))
    timer.daemon = True
    _auto['timer'] = timer
    timer.start()


def cancel_auto_export():
    if _auto['timer']:
        _auto['timer'].cancel()
        _auto['timer'] = None


def auto_export():
    _auto['timer'] = None
    if not (SERVER_HTTPD and load_settings().get('autoExport')):
        return
    app = adsk.core.Application.get()
    # Läuft gerade ein Befehl (z. B. Extrusion mit Vorschau), später erneut versuchen
    if app.userInterface.activeCommand != 'SelectCommand':
        schedule_auto_export()
        return
    design = adsk.fusion.Design.cast(app.activeProduct)
    if not design:
        return
    if design_fingerprint(design) == _auto['fingerprint']:
        return
    t0 = time.time()
    meta = run_export(design, load_settings())
    if meta:
        log(f"Auto-Export ({meta['format']}) in {time.time() - t0:.2f} s")


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
            if SERVER_HTTPD:
                ui.messageBox("Server läuft bereits.\n\nMögliche URLs:\n" + url_list())
                return
            error = start_server()
            if error:
                ui.messageBox("Server konnte nicht starten:\n\n" + error)
            else:
                # Mit Auto-Export liegt gleich das aktuelle Modell bereit
                _auto['fingerprint'] = None
                schedule_auto_export()
                auto_hint = "\nAuto-Export ist aktiv.\n" if load_settings().get('autoExport') else ""
                ui.messageBox("Server gestartet!\n\nMögliche URLs:\n" + url_list() + auto_hint +
                              "\n(Zertifikat im Browser akzeptieren!)")
        except:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

class StopServerCommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        app = adsk.core.Application.get()
        ui = app.userInterface
        try:
            if SERVER_HTTPD:
                stop_server()
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

            meta = run_export(design, load_settings())
            if not meta:
                ui.messageBox("Export fehlgeschlagen.")
            elif meta['format'] == 'glb':
                tris = f"{meta['triangles']:,}".replace(',', '.')
                kb = f"{meta['bytes'] / 1024:,.0f}".replace(',', '.')
                ui.messageBox(f"Export erfolgreich (GLB)\n\n"
                              f"{len(meta['bodies'])} Körper, {tris} Dreiecke\n"
                              f"{kb} KB in {meta['exportSeconds']} s\n\n"
                              f"Die Brille lädt das Modell automatisch neu.")
            else:
                ui.messageBox("Export erfolgreich (OBJ)\nDie Brille lädt das Modell automatisch neu.")
        except:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

class SettingsCommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            inputs = args.command.commandInputs
            fmt = inputs.itemById('format').selectedItem.index
            quality = inputs.itemById('quality').selectedItem.index
            save_settings({'format': FORMAT_LABELS[fmt][0], 'quality': QUALITY_LABELS[quality][0],
                           'autoExport': inputs.itemById('autoExport').value})
            # Neue Einstellungen sofort wirksam machen
            _auto['fingerprint'] = None
            schedule_auto_export()
        except:
            adsk.core.Application.get().userInterface.messageBox('Failed:\n{}'.format(traceback.format_exc()))

# Befehle, die das Modell nicht verändern – lösen keinen Auto-Export aus
IGNORED_COMMANDS = {
    'SelectCommand', 'PanCommand', 'OrbitCommand', 'FreeOrbitCommand', 'ConstrainedOrbitCommand',
    'ZoomCommand', 'ZoomWindowCommand', 'FitCommand', 'LookAtCommand',
    CMD_START_ID, CMD_STOP_ID, CMD_EXPORT_ID, CMD_SETTINGS_ID,
}

class CommandTerminatedHandler(adsk.core.ApplicationCommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            if (args.terminationReason == adsk.core.CommandTerminationReason.CompletedTerminationReason
                    and args.commandId not in IGNORED_COMMANDS):
                schedule_auto_export()
        except:
            log(traceback.format_exc())

class DocumentActivatedHandler(adsk.core.DocumentEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        schedule_auto_export()

class AutoExportEventHandler(adsk.core.CustomEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            auto_export()
        except:
            log('Auto-Export fehlgeschlagen:\n' + traceback.format_exc())

class CommandCreatedEventHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self, handler_cls):
        super().__init__()
        self.handler_cls = handler_cls
    def notify(self, args):
        try:
            cmd = args.command
            if self.handler_cls is SettingsCommandExecuteHandler:
                build_settings_dialog(cmd)
            onExecute = self.handler_cls()
            cmd.execute.add(onExecute)
            # Keep the handler referenced to prevent GC
            _handlers.append(onExecute)
        except:
            app = adsk.core.Application.get()
            app.userInterface.messageBox('Failed:\n{}'.format(traceback.format_exc()))

def build_settings_dialog(cmd):
    settings = load_settings()
    inputs = cmd.commandInputs
    fmt = inputs.addDropDownCommandInput('format', 'Format', adsk.core.DropDownStyles.TextListDropDownStyle)
    for key, label in FORMAT_LABELS:
        fmt.listItems.add(label, key == settings['format'])
    quality = inputs.addDropDownCommandInput('quality', 'Tessellierung', adsk.core.DropDownStyles.TextListDropDownStyle)
    for key, label in QUALITY_LABELS:
        quality.listItems.add(label, key == settings['quality'])
    auto = inputs.addBoolValueInput('autoExport', 'Auto-Export', True, '', settings['autoExport'])
    auto.tooltip = 'Exportiert nach jeder Änderung automatisch, solange der Server läuft'

# Keep handlers in memory
_handlers = []
_event_handlers = []

COMMANDS = [
    (CMD_START_ID, 'WebXR Server Starten', 'Startet lokalen HTTPS Server für Quest 3', StartServerCommandExecuteHandler),
    (CMD_STOP_ID, 'WebXR Server Stoppen', 'Stoppt den lokalen HTTPS Server', StopServerCommandExecuteHandler),
    (CMD_EXPORT_ID, 'WebXR Export', 'Exportiert aktuelles Modell für WebXR', ExportCommandExecuteHandler),
    (CMD_SETTINGS_ID, 'WebXR Einstellungen', 'Exportformat und Tessellierung', SettingsCommandExecuteHandler),
]

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface

        cmdDefs = ui.commandDefinitions
        RESOURCES = os.path.join(SCRIPT_DIR, 'resources')

        # Add to UI: "Utilities" tab (Tools) under a new panel "WebXR"
        xr_panel = None
        design_ws = ui.workspaces.itemById('FusionSolidEnvironment')
        if design_ws:
            tools_tab = design_ws.toolbarTabs.itemById(TAB_ID)
            if tools_tab:
                panels = tools_tab.toolbarPanels
                xr_panel = panels.itemById(PANEL_ID)
                if not xr_panel:
                    xr_panel = panels.add(PANEL_ID, 'WebXR Streamer', 'SelectPanel', False)

        for cmd_id, name, tooltip, handler_cls in COMMANDS:
            cmd_def = cmdDefs.itemById(cmd_id)
            if not cmd_def:
                icon_dir = os.path.join(RESOURCES, cmd_id)
                if os.path.isdir(icon_dir):
                    cmd_def = cmdDefs.addButtonDefinition(cmd_id, name, tooltip, icon_dir)
                else:
                    cmd_def = cmdDefs.addButtonDefinition(cmd_id, name, tooltip)

            onCreated = CommandCreatedEventHandler(handler_cls)
            cmd_def.commandCreated.add(onCreated)
            _handlers.append(onCreated)

            if xr_panel and not xr_panel.controls.itemById(cmd_id):
                xr_panel.controls.addCommand(cmd_def)

        # Auto-Export: Änderungen erkennen und gebündelt im Hauptthread exportieren
        try:
            app.unregisterCustomEvent(AUTO_EXPORT_EVENT_ID)  # Rest eines abgestürzten Laufs
        except Exception:
            pass
        _auto['event'] = app.registerCustomEvent(AUTO_EXPORT_EVENT_ID)
        for event, handler in ((_auto['event'], AutoExportEventHandler()),
                               (ui.commandTerminated, CommandTerminatedHandler()),
                               (app.documentActivated, DocumentActivatedHandler())):
            event.add(handler)
            _handlers.append(handler)
            _event_handlers.append((event, handler))

    except:
        if ui:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

def stop(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface

        stop_server()

        for event, handler in _event_handlers:
            event.remove(handler)
        _event_handlers.clear()
        try:
            app.unregisterCustomEvent(AUTO_EXPORT_EVENT_ID)
        except Exception:
            pass

        # Remove Panel
        design_ws = ui.workspaces.itemById('FusionSolidEnvironment')
        if design_ws:
            tools_tab = design_ws.toolbarTabs.itemById(TAB_ID)
            if tools_tab:
                panel = tools_tab.toolbarPanels.itemById(PANEL_ID)
                if panel:
                    panel.deleteMe()

        # Remove Commands
        for cmd_id, _, _, _ in COMMANDS:
            cmd_def = ui.commandDefinitions.itemById(cmd_id)
            if cmd_def:
                cmd_def.deleteMe()

    except:
        if ui:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))
