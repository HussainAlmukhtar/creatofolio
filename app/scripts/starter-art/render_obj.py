"""A tiny software renderer for Kenney's low-poly OBJ models: orthographic
camera, z-buffer, flat shading, supersampled. Enough to turn a model into a
sharp sprite at any size, with no 3D software needed.

    from render_obj import render
    im = render('loungeSofa.obj', height=400, yaw=0)      # RGBA PIL image
"""
import math, os
import numpy as np
from PIL import Image

def _load(path):
    V, VT, tris, mats, cur = [], [], [], {}, None
    base = os.path.dirname(path)
    for line in open(path, encoding='utf-8', errors='ignore'):
        p = line.split()
        if not p: continue
        if p[0] == 'v': V.append([float(x) for x in p[1:4]])
        elif p[0] == 'vt': VT.append([float(x) for x in p[1:3]])
        elif p[0] == 'mtllib': mats.update(_mtl(os.path.join(base, ' '.join(p[1:]))))
        elif p[0] == 'usemtl': cur = p[1]
        elif p[0] == 'f':
            idx = []
            for c in p[1:]:
                a = c.split('/')
                idx.append((int(a[0]) - 1, int(a[1]) - 1 if len(a) > 1 and a[1] else -1))
            for i in range(1, len(idx) - 1): tris.append((idx[0], idx[i], idx[i + 1], cur))
    return np.array(V), (np.array(VT) if VT else np.zeros((1, 2))), tris, mats

def _mtl(path):
    out, cur = {}, None
    base = os.path.dirname(path)
    for line in open(path, encoding='utf-8', errors='ignore'):
        p = line.split()
        if not p: continue
        if p[0] == 'newmtl': cur = p[1]; out[cur] = {'kd': (0.8, 0.8, 0.8), 'tex': None}
        elif p[0] == 'Kd' and cur: out[cur]['kd'] = tuple(float(x) for x in p[1:4])
        elif p[0] == 'map_Kd' and cur:
            out[cur]['tex'] = np.asarray(Image.open(os.path.join(base, ' '.join(p[1:]))).convert('RGB'), dtype=np.float32) / 255
    return out

def render(path, height=400, yaw=0.0, pitch=0.0, ss=3, light=(0.30, 0.62, 0.72), ambient=0.55, pad=2, warp=None, pick=None):
    """Returns an RGBA image cropped to the model. `warp(V)` may reshape the
    vertices first. With `pick=(r, g, b)` (a base colour, 0-255) it returns
    (uncropped image, bbox of the faces in that colour) instead."""
    V, VT, tris, mats = _load(path)
    if warp is not None: V = warp(V.copy())
    cy, sy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    cp, sp = math.cos(math.radians(pitch)), math.sin(math.radians(pitch))
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]); Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    P = V @ Ry.T @ Rx.T                                   # camera looks down -z
    mn, mx = P.min(0), P.max(0)
    scale = (height * ss) / max(mx[1] - mn[1], 1e-6)
    W = int(math.ceil((mx[0] - mn[0]) * scale)) + 2 * pad * ss; H = height * ss + 2 * pad * ss
    X = (P[:, 0] - mn[0]) * scale + pad * ss; Y = (mx[1] - P[:, 1]) * scale + pad * ss; Z = P[:, 2]
    col = np.zeros((H, W, 3), np.float32); zb = np.full((H, W), -1e9, np.float32); alpha = np.zeros((H, W), bool)
    L = np.array(light, float); L /= np.linalg.norm(L)
    picked = np.zeros((H, W), bool)
    for (a, b, c, m) in tris:
        ia, ib, ic = a[0], b[0], c[0]
        n = np.cross(P[ib] - P[ia], P[ic] - P[ia]); ln = np.linalg.norm(n)
        if ln < 1e-12: continue
        n /= ln
        if n[2] < 0: n = -n                                # face the camera
        shade = min(1.14, ambient + (1 - ambient) * max(0.0, float(n @ L)) / L[2])   # faces towards the camera keep their colour
        x0, x1 = int(max(0, math.floor(min(X[ia], X[ib], X[ic])))), int(min(W - 1, math.ceil(max(X[ia], X[ib], X[ic]))))
        y0, y1 = int(max(0, math.floor(min(Y[ia], Y[ib], Y[ic])))), int(min(H - 1, math.ceil(max(Y[ia], Y[ib], Y[ic]))))
        if x1 < x0 or y1 < y0: continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        den = (Y[ib] - Y[ic]) * (X[ia] - X[ic]) + (X[ic] - X[ib]) * (Y[ia] - Y[ic])
        if abs(den) < 1e-9: continue
        w0 = ((Y[ib] - Y[ic]) * (gx - X[ic]) + (X[ic] - X[ib]) * (gy - Y[ic])) / den
        w1 = ((Y[ic] - Y[ia]) * (gx - X[ic]) + (X[ia] - X[ic]) * (gy - Y[ic])) / den
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
        if not inside.any(): continue
        z = w0 * Z[ia] + w1 * Z[ib] + w2 * Z[ic]
        sub = zb[y0:y1 + 1, x0:x1 + 1]; hit = inside & (z > sub)
        if not hit.any(): continue
        mat = mats.get(m, {'kd': (0.8, 0.8, 0.8), 'tex': None})
        if mat['tex'] is not None and a[1] >= 0:
            t = mat['tex']; uv = (VT[a[1]] + VT[b[1]] + VT[c[1]]) / 3
            flat = t[min(t.shape[0] - 1, max(0, int((1 - uv[1]) * t.shape[0]))), min(t.shape[1] - 1, max(0, int(uv[0] * t.shape[1])))]
            u = w0 * VT[a[1]][0] + w1 * VT[b[1]][0] + w2 * VT[c[1]][0]; v = w0 * VT[a[1]][1] + w1 * VT[b[1]][1] + w2 * VT[c[1]][1]
            base = t[np.clip(((1 - v) * t.shape[0]).astype(int), 0, t.shape[0] - 1), np.clip((u * t.shape[1]).astype(int), 0, t.shape[1] - 1)][hit]
        else: flat = base = np.array(mat['kd'], np.float32)
        sub[hit] = z[hit]; col[y0:y1 + 1, x0:x1 + 1][hit] = np.clip(base * shade, 0, 1); alpha[y0:y1 + 1, x0:x1 + 1][hit] = True
        if pick is not None: picked[y0:y1 + 1, x0:x1 + 1][hit] = bool(np.abs(np.asarray(flat) * 255 - np.asarray(pick)).max() < 3)
    rgba = np.dstack([col, alpha.astype(np.float32)])
    im = Image.fromarray((rgba * 255).astype(np.uint8), 'RGBA')
    im = im.resize((max(1, W // ss), max(1, H // ss)), Image.LANCZOS)
    if pick is not None:
        ys, xs = np.nonzero(picked)
        return im, (xs.min() / ss, ys.min() / ss, (xs.max() + 1) / ss, (ys.max() + 1) / ss)
    return im.crop(im.getbbox())
