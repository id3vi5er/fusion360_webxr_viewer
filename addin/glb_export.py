# GLB-Export ohne externe Abhängigkeiten
# Tesselliert alle sichtbaren Körper der Baugruppe und schreibt eine glTF-2.0-Binärdatei
# mit Bauteilbaum, PBR-Materialien aus den Fusion-Darstellungen und Metadaten.

import adsk.core, adsk.fusion
import json
import os
import struct
import time
from array import array

CM_TO_M = 0.01

QUALITY = {
    'low': adsk.fusion.TriangleMeshQualityOptions.LowQualityTriangleMesh,
    'normal': adsk.fusion.TriangleMeshQualityOptions.NormalQualityTriangleMesh,
    'high': adsk.fusion.TriangleMeshQualityOptions.HighQualityTriangleMesh,
    'veryhigh': adsk.fusion.TriangleMeshQualityOptions.VeryHighQualityTriangleMesh,
}

FACE_APPEARANCE_SOURCE = 3

# glTF Konstanten
FLOAT = 5126
UINT32 = 5125
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963


# -----------------------------------------------------------------------------
# Darstellung -> PBR-Material
# -----------------------------------------------------------------------------
def _srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _prop(appearance, prop_id):
    try:
        p = appearance.appearanceProperties.itemById(prop_id)
        return p.value if p else None
    except:
        return None


def appearance_to_material(appearance):
    """Bildet die Fusion-Darstellungsmodelle (opak, Metall, Lack, Glas) auf glTF-PBR ab."""
    name = appearance.name if appearance else 'Standard'
    color = None
    metallic = 0.0
    roughness = 0.5
    opacity = 1.0

    if appearance:
        model = _prop(appearance, 'interior_model')
        rough = _prop(appearance, 'surface_roughness')
        if model == 1:  # Metall
            color = _prop(appearance, 'metal_f0')
            metallic = 1.0
        elif model == 2:  # Lack / geschichtet
            color = _prop(appearance, 'layered_diffuse')
            rough = _prop(appearance, 'layered_roughness')
            metallic = 0.3
        elif model == 3:  # Glas / transparent
            color = _prop(appearance, 'transparent_color')
            opacity = 0.35
        else:  # opak (Kunststoff, Holz, ...)
            color = _prop(appearance, 'opaque_albedo')
            if _prop(appearance, 'opaque_translucency'):
                opacity = 0.8

        if color is None:
            # Unbekanntes Modell oder Textur: erste brauchbare Farbe nehmen
            for i in range(appearance.appearanceProperties.count):
                p = appearance.appearanceProperties.item(i)
                if isinstance(p, adsk.core.ColorProperty) and p.value and not p.id.startswith(('surface_albedo', 'opaque_luminance', 'opaque_mfp')):
                    color = p.value
                    break
        if rough is not None:
            roughness = max(0.0, min(1.0, float(rough)))

    if color is not None:
        rgb = [_srgb_to_linear(color.red), _srgb_to_linear(color.green), _srgb_to_linear(color.blue)]
        if color.opacity < 255:
            opacity = min(opacity, color.opacity / 255.0)
    else:
        rgb = [0.5, 0.5, 0.5]

    mat = {
        'name': name,
        'pbrMetallicRoughness': {
            'baseColorFactor': rgb + [opacity],
            'metallicFactor': metallic,
            'roughnessFactor': roughness,
        },
    }
    if opacity < 1.0:
        mat['alphaMode'] = 'BLEND'
        mat['doubleSided'] = True
    return mat


# -----------------------------------------------------------------------------
# GLB-Builder
# -----------------------------------------------------------------------------
class GlbBuilder:
    def __init__(self):
        self.bin = bytearray()
        self.buffer_views = []
        self.accessors = []
        self.meshes = []
        self.materials = []
        self.nodes = []
        self._material_index = {}

    def _add_view(self, data, target):
        while len(self.bin) % 4:
            self.bin.append(0)
        offset = len(self.bin)
        self.bin += data
        self.buffer_views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(data), 'target': target})
        return len(self.buffer_views) - 1

    def _add_accessor(self, view, comp_type, count, acc_type, vmin=None, vmax=None):
        acc = {'bufferView': view, 'componentType': comp_type, 'count': count, 'type': acc_type}
        if vmin is not None:
            acc['min'] = vmin
            acc['max'] = vmax
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def material(self, appearance):
        key = appearance.id if appearance else '__default__'
        if key not in self._material_index:
            self.materials.append(appearance_to_material(appearance))
            self._material_index[key] = len(self.materials) - 1
        return self._material_index[key]

    def primitive(self, positions, normals, indices, material):
        """positions/normals: array('f') in Metern, indices: array('I')."""
        count = len(positions) // 3
        xs, ys, zs = positions[0::3], positions[1::3], positions[2::3]
        vmin = [min(xs), min(ys), min(zs)]
        vmax = [max(xs), max(ys), max(zs)]
        pos_acc = self._add_accessor(self._add_view(positions.tobytes(), ARRAY_BUFFER), FLOAT, count, 'VEC3', vmin, vmax)
        attrs = {'POSITION': pos_acc}
        if len(normals) == len(positions):
            attrs['NORMAL'] = self._add_accessor(self._add_view(normals.tobytes(), ARRAY_BUFFER), FLOAT, count, 'VEC3')
        idx_acc = self._add_accessor(self._add_view(indices.tobytes(), ELEMENT_ARRAY_BUFFER), UINT32, len(indices), 'SCALAR')
        return {'attributes': attrs, 'indices': idx_acc, 'material': material}, vmin, vmax

    def add_node(self, node):
        self.nodes.append(node)
        return len(self.nodes) - 1

    def write(self, path, scene_nodes, asset_extras=None):
        gltf = {
            'asset': {'version': '2.0', 'generator': 'FusionToWebXR'},
            'scene': 0,
            'scenes': [{'nodes': scene_nodes}],
            'nodes': self.nodes,
            'meshes': self.meshes,
            'materials': self.materials,
            'accessors': self.accessors,
            'bufferViews': self.buffer_views,
            'buffers': [{'byteLength': len(self.bin)}],
        }
        if asset_extras:
            gltf['asset']['extras'] = asset_extras
        if not self.meshes:
            for key in ('meshes', 'materials', 'accessors', 'bufferViews', 'buffers'):
                del gltf[key]

        json_bytes = json.dumps(gltf, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        json_bytes += b' ' * ((4 - len(json_bytes) % 4) % 4)
        bin_bytes = bytes(self.bin) + b'\x00' * ((4 - len(self.bin) % 4) % 4)

        chunks = struct.pack('<II', len(json_bytes), 0x4E4F534A) + json_bytes
        if self.meshes:
            chunks += struct.pack('<II', len(bin_bytes), 0x004E4942) + bin_bytes
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, 12 + len(chunks)))
            f.write(chunks)


# -----------------------------------------------------------------------------
# Tessellierung
# -----------------------------------------------------------------------------
def _mesh_arrays(entity, quality):
    calc = entity.meshManager.createMeshCalculator()
    calc.setQuality(quality)
    mesh = calc.calculate()
    if not mesh or mesh.triangleCount == 0:
        return None
    positions = array('f', (v * CM_TO_M for v in mesh.nodeCoordinatesAsFloat))
    normals = array('f', mesh.normalVectorsAsFloat)
    indices = array('I', mesh.nodeIndices)
    return positions, normals, indices, mesh.triangleCount


def _face_groups(body):
    """Gruppiert Flächen nach Darstellung, falls einzelne Flächen eine eigene haben."""
    groups = {}
    has_face_override = False
    for face in body.faces:
        try:
            if face.appearanceSourceType == FACE_APPEARANCE_SOURCE:
                has_face_override = True
        except:
            pass
        ap = face.appearance
        key = ap.id if ap else '__default__'
        groups.setdefault(key, (ap, []))[1].append(face)
    return list(groups.values()) if has_face_override else None


def _body_mesh(builder, body, quality):
    """Liefert (mesh_dict, vmin, vmax, tris) oder None."""
    primitives = []
    vmin = [float('inf')] * 3
    vmax = [float('-inf')] * 3
    tris = 0

    def add(entity, appearance):
        nonlocal tris
        arrays = _mesh_arrays(entity, quality)
        if not arrays:
            return
        positions, normals, indices, count = arrays
        prim, pmin, pmax = builder.primitive(positions, normals, indices, builder.material(appearance))
        primitives.append(prim)
        for i in range(3):
            vmin[i] = min(vmin[i], pmin[i])
            vmax[i] = max(vmax[i], pmax[i])
        tris += count

    groups = _face_groups(body)
    if groups:
        for appearance, faces in groups:
            for face in faces:
                add(face, appearance)
    else:
        add(body, body.appearance)

    if not primitives:
        return None
    return {'name': body.name, 'primitives': primitives}, vmin, vmax, tris


def _merge_bbox(a, b):
    if a is None:
        return [list(b[0]), list(b[1])]
    return [[min(a[0][i], b[0][i]) for i in range(3)], [max(a[1][i], b[1][i]) for i in range(3)]]


# -----------------------------------------------------------------------------
# Export
# -----------------------------------------------------------------------------
def export_design(design, out_dir, quality='normal', z_up=None, base_name='model'):
    """Exportiert das Design nach <out_dir>/<base_name>.glb und gibt die Metadaten zurück.

    Die Dateien werden zuerst unter temporärem Namen geschrieben und dann ersetzt,
    damit die Brille nie eine halb geschriebene Datei lädt.
    """
    t0 = time.time()
    app = adsk.core.Application.get()
    q = QUALITY.get(quality, QUALITY['normal'])
    if z_up is None:
        z_up = app.preferences.generalPreferences.defaultModelingOrientation == adsk.core.DefaultModelingOrientations.ZUpModelingOrientation

    builder = GlbBuilder()
    bodies_meta = []
    total_tris = 0

    def visit(component, occurrence, path):
        """Gibt (node_index, bbox) zurück; None, wenn nichts Sichtbares darunter liegt."""
        nonlocal total_tris
        children = []
        bbox = None

        bodies = occurrence.bRepBodies if occurrence else component.bRepBodies
        for body in bodies:
            if not body.isVisible:
                continue
            result = _body_mesh(builder, body, q)
            if not result:
                continue
            mesh, vmin, vmax, tris = result
            builder.meshes.append(mesh)
            body_path = path + [body.name]
            node = builder.add_node({
                'name': body.name,
                'mesh': len(builder.meshes) - 1,
                'extras': {'kind': 'body', 'path': '/'.join(body_path), 'token': body.entityToken},
            })
            children.append(node)
            bbox = _merge_bbox(bbox, (vmin, vmax))
            total_tris += tris
            bodies_meta.append({
                'node': node,
                'name': body.name,
                'path': '/'.join(body_path),
                'token': body.entityToken,
                'appearance': body.appearance.name if body.appearance else None,
                'bbox': [vmin, vmax],
                'triangles': tris,
            })

        child_occs = occurrence.childOccurrences if occurrence else component.occurrences
        for occ in child_occs:
            if not occ.isVisible:
                continue
            result = visit(occ.component, occ, path + [occ.name])
            if result:
                children.append(result[0])
                bbox = _merge_bbox(bbox, result[1])

        if not children:
            return None
        node = {'name': occurrence.name if occurrence else component.name, 'children': children,
                'extras': {'kind': 'occurrence' if occurrence else 'root', 'path': '/'.join(path)}}
        if occurrence:
            node['extras']['token'] = occurrence.entityToken
        return builder.add_node(node), bbox

    root = design.rootComponent
    result = visit(root, None, [root.name])
    scene_nodes = []
    bbox = None
    if result:
        root_node, bbox = result
        if z_up:
            # Fusion Z-up -> glTF Y-up: -90° um X
            builder.nodes[root_node]['rotation'] = [-0.7071067811865476, 0.0, 0.0, 0.7071067811865476]
        scene_nodes = [root_node]

    version = int(time.time() * 1000)
    meta = {
        'version': version,
        'format': 'glb',
        'file': base_name + '.glb',
        'document': app.activeDocument.name if app.activeDocument else None,
        'units': 'm',
        'upAxis': 'Z' if z_up else 'Y',
        'quality': quality,
        'bbox': bbox,
        'triangles': total_tris,
        'bodies': bodies_meta,
        'exportSeconds': None,
    }

    if not os.path.exists(out_dir):
        os.makedirs(out_dir)
    glb_path = os.path.join(out_dir, base_name + '.glb')
    tmp = glb_path + '.tmp'
    builder.write(tmp, scene_nodes, {'version': version})
    os.replace(tmp, glb_path)

    meta['exportSeconds'] = round(time.time() - t0, 2)
    meta['bytes'] = os.path.getsize(glb_path)
    write_scene_json(out_dir, meta)
    return meta


def write_scene_json(out_dir, meta):
    # scene.json zuletzt schreiben: die Brille lädt neu, sobald sich die Version ändert
    path = os.path.join(out_dir, 'scene.json')
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)
