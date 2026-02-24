import adsk.core, adsk.fusion, traceback
import os

def run(context):
    app = adsk.core.Application.get()
    ui = app.userInterface
    try:
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            ui.messageBox('Kein aktives Design.')
            return

        # Zielpfad auf dem Server
        server_static_dir = "C:/Users/nratt/Desktop/fusion360_vr/server/static"
        
        # WICHTIG: Dateiname ohne Endung für Flexibilität
        base_name = "model"
        obj_path = os.path.normpath(os.path.join(server_static_dir, base_name + ".obj"))
        mtl_path = os.path.normpath(os.path.join(server_static_dir, base_name + ".mtl"))

        # Verzeichnis sicherstellen
        if not os.path.exists(server_static_dir):
            os.makedirs(server_static_dir)

        # Alte Dateien löschen (verhindert Caching-Probleme)
        if os.path.exists(obj_path): os.remove(obj_path)
        if os.path.exists(mtl_path): os.remove(mtl_path)

        # Export Manager
        export_mgr = design.exportManager
        
        # OBJ Export Optionen erstellen
        options = export_mgr.createOBJExportOptions(design.rootComponent, obj_path)
        
        # Ausführen
        success = export_mgr.execute(options)
        
        if success:
            msg = "Export erfolgreich!\n"
            if os.path.exists(mtl_path):
                msg += "Farben (MTL) wurden generiert."
            else:
                msg += "WARNUNG: Keine MTL-Datei gefunden. Farben fehlen evtl."
            
            ui.messageBox(msg)
        else:
            ui.messageBox("Export fehlgeschlagen.")

    except:
        ui.messageBox("Fehler:\n" + traceback.format_exc())

def stop(context):
    pass
