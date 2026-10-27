# Roadmap FusionToWebXR

Stand: 2026-10-28 · Fusion 2706.1.14 · Quest 3 (Meta Quest Browser)

Aufwand: **S** = wenige Stunden, **M** = ein Abend bis Tag, **L** = mehrere Tage.

## Status

- **Phase 0:** erledigt (2026-10-28), außer Endabnahme in der Quest.
- **Phase 1:** erledigt (2026-10-28), getestet an einer kleinen Baugruppe
  (verschachtelte Bauteile, Mehrfach-Instanz, ausgeblendete Körper, Glas und Metall).
  Offen: großes Modell (>500k Dreiecke) und Flächen mit eigener Darstellung.
- **Vorgezogen aus Phase 2:** `ThreadingHTTPServer` ist schon drin (2.1 zur Hälfte).

Erkenntnisse aus der Umsetzung:
- Proxy-Körper liefern ihr Netz bereits in Weltkoordinaten (cm). Der Exporter schreibt deshalb
  die Knoten ohne eigene Transformationen; die Hierarchie dient nur zur Gliederung.
- Eine Darstellung am Körper hat Vorrang vor der Überschreibung am Bauteil (wie in der Fusion-Anzeige).
- Der OBJ-Export von Fusion ignoriert die Sichtbarkeit und kommt Z-up an; GLB respektiert
  beides und dreht Z-up-Modelle nach Y-up.
- Unter Windows muss der Server `SO_EXCLUSIVEADDRUSE` setzen, sonst wird ein belegter Port nicht erkannt.

## Leitentscheidungen

1. **Eigener GLB-Export statt OBJ.** Das Add-in tesselliert jeden Körper selbst
   (`BRepBody.meshManager.createMeshCalculator()`) und schreibt eine GLB-Datei mit
   reinem Python (ohne Abhängigkeiten). So bekommen wir:
   - den Bauteilbaum als Knoten, inklusive Transformationen
   - Namen und Fusion-`entityToken` je Körper
   - Farben und Transparenz aus den Fusion-Darstellungen (`Appearance` → PBR-Material)
   - die Einheit in Metern, also einen garantierten Maßstab 1:1

   Das Frontend lädt dann mit `GLTFLoader`. OBJ bleibt als Rückfall-Lösung erhalten.
   Der eingebaute USD-Export wäre zwar möglich, aber der USDZ-Loader von Three.js
   ist eingeschränkt, deshalb fiel die Wahl auf GLB.
2. **Alles, was Fusion anfasst, läuft im Hauptthread.** Der Server-Thread ruft keine
   Fusion-API direkt auf, sondern löst ein Custom Event aus
   (`app.registerCustomEvent` / `fireCustomEvent`). Das betrifft Dialoge, Export,
   Auswahl und Parameter.
3. **Push statt Polling.** Der Server wird zum `ThreadingHTTPServer` mit
   Server-Sent Events (`/events`). Mit dem bisherigen Single-Thread-`HTTPServer`
   würde eine offene SSE-Verbindung alles andere blockieren.
4. **Kein Build-Schritt.** Das Frontend bleibt Vanilla JS mit ES-Modulen.
   Three.js liegt lokal unter `www/vendor/`, damit alles offline läuft.

## Phase 0 – Stabilisieren (S–M)

| # | Aufgabe | Aufwand |
|---|---|---|
| 0.1 | Pivot-Fehler beim Skalieren mit zwei Händen beheben: Zentrierung in eine eigene Gruppe, skaliert wird `modelGroup` selbst | S |
| 0.2 | Stopp-Knopf registrieren (Handler existiert schon) | S |
| 0.3 | Keine `messageBox` aus dem Server-Thread; Startmeldung erst nach erfolgreichem Bind, Fehler (Port belegt, Zertifikat fehlt) sauber melden | S |
| 0.4 | Atomarer Export: erst in eine temporäre Datei schreiben, dann `os.replace` | S |
| 0.5 | Startplatzierung erst nach `sessionstart` und stabiler Kopfposition | S |
| 0.6 | Three.js lokal mitliefern; ungenutzten `hit-test` vorerst optional machen | S |
| 0.7 | Debug-Panel ausblendbar; Y setzt Maßstab **und** Position zurück | S |
| 0.8 | README: falsche Badges und Lizenzangabe korrigieren | S |

## Phase 1 – Neue Datenpipeline (L)

*Voraussetzung für Phase 4–6.*

| # | Aufgabe | Aufwand |
|---|---|---|
| 1.1 | Tessellierung je Körper über Occurrences rekursiv, sichtbare Körper, Qualitätsstufe wählbar (grob/normal/fein) | M |
| 1.2 | Minimaler GLB-Writer: Knoten, Meshes (Position/Normal/Index), Materialien | M |
| 1.3 | Darstellung → Material: Farbe, Deckkraft, Metall/Rauheit, soweit auslesbar | S–M |
| 1.4 | `scene.json` mit Metadaten: Bauteilpfad, Name, Token, Hüllquader, Exportversion | S |
| 1.5 | Frontend auf `GLTFLoader`, Maßstab 1:1 aus Metern | S |
| 1.6 | Testmodelle: Einzelteil, Baugruppe mit Unterbaugruppen, transparente Teile, großes Modell (>500k Dreiecke) | M |

## Phase 2 – Live-Sync (M)

| # | Aufgabe | Aufwand |
|---|---|---|
| 2.1 | `ThreadingHTTPServer` und `/events` (SSE); Brille lädt bei Versionswechsel neu | S |
| 2.2 | Auto-Export bei `ui.commandTerminated` und `app.documentSaved`, entprellt (z. B. 1,5 s), abschaltbar | M |
| 2.3 | Ladeanzeige und Fehleranzeige in VR; Position und Maßstab bleiben beim Neuladen erhalten | S |

## Phase 3 – Bedienung in VR (M–L)

| # | Aufgabe | Aufwand |
|---|---|---|
| 3.1 | Menü am Handgelenk oder am Controller (Canvas-Textur, Raycast-Klicks) | M |
| 3.2 | Greifen nur, wenn der Strahl das Modell trifft; Strahl sichtbar mit Trefferpunkt | S |
| 3.3 | Maßstab-Voreinstellungen 1:1 / 1:2 / 1:10 / frei, Anzeige des aktuellen Maßstabs | S |
| 3.4 | „Aufrecht halten“: Drehen nur um die Hochachse | S |
| 3.5 | Handtracking: Pinch greifen, beide Hände skalieren, Handmodelle | M |
| 3.6 | Darstellungsmodi: normal, Drahtgitter, Röntgen | S |

## Phase 4 – Werkzeuge (L)

| # | Aufgabe | Aufwand | braucht |
|---|---|---|---|
| 4.1 | Auf echte Flächen stellen: hit-test, Modell landet auf Tisch oder Boden | M | 3.1 |
| 4.2 | Hüllquader und Gesamtmaße einblenden (mm) | S | 1.5 |
| 4.3 | Messen Punkt zu Punkt, mit Einrasten an Ecken | M | 1.5, 3.2 |
| 4.4 | Schnittebene mit der Hand verschiebbar (`clippingPlanes`, mit Schnittkappe als Kür) | M | 1.5 |
| 4.5 | Bauteilliste: ein-/ausblenden, isolieren | M | 1.4, 3.1 |
| 4.6 | Explosionsansicht (radial vom Baugruppen-Zentrum, Regler) | M | 1.4 |

## Phase 5 – Quest-3-Extras (M)

| # | Aufgabe | Aufwand | Hinweis |
|---|---|---|---|
| 5.1 | Raumanker: Modell bleibt nach Neuladen am selben Ort | M | WebXR Anchors, persistente Anker im Quest Browser |
| 5.2 | Verdeckung durch echte Hände und Objekte | M | WebXR `depth-sensing`, Shader-Anpassung |
| 5.3 | Schatten auf den echten Boden (Shadow-Catcher-Ebene) | S | |
| 5.4 | Raumlicht übernehmen | S | `light-estimation`, Unterstützung im Quest Browser **ungeprüft** |

## Phase 6 – Rückkanal zu Fusion (L)

| # | Aufgabe | Aufwand | braucht |
|---|---|---|---|
| 6.1 | Auswahl spiegeln Fusion → Brille (`activeSelectionChanged` → SSE, Highlight per Token) | M | 1.4, 2.1 |
| 6.2 | Auswahl Brille → Fusion (POST → Custom Event → `ui.activeSelections`) | M | 6.1 |
| 6.3 | Benutzerparameter als Regler in VR → Fusion rechnet neu → Auto-Export | M | 2.2, 3.1 |
| 6.4 | Versionsvergleich: vorigen Export als halbtransparenten Geist einblenden | S | 1.5 |

## Reihenfolge

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──┬─► Phase 4
                                              ├─► Phase 5
                                              └─► Phase 6
```

Die Phasen 4–6 sind untereinander unabhängig und können nach Interesse gewählt werden.

## Testen

- **Logik** im Desktop-Browser mit dem *Immersive Web Emulator* (WebXR-Emulation).
- **Fusion-Seite** über das Fusion-MCP: Export auslösen, Dateien und `scene.json` prüfen.
- **Endabnahme** jeder Phase in der Quest 3.
- Vor jedem Test prüfen, aus welchem Pfad Fusion das Add-in lädt (`sys.modules`).
