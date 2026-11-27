"""Builds the wall-and-floor backdrop (1520x960) of each seed room into
app/public/rooms/ from open textures. Nothing is drawn here: the script only
tints the textures and lays them out in perspective.

Textures (all CC0, see THIRD_PARTY_NOTICES.md):
  - "Seamless Cartoon Textures" by OzMaister
      https://opengameart.org/content/seamless-cartoon-textures
      (wood_floor.jpg, plaster_wall.jpg, wood_base.jpg, wood_base_sharp.jpg,
       marble.jpg, stone_patio.jpg)
  - "Wooden Floors (2K)" by PamNawi
      https://opengameart.org/content/wooden-floors-2k  (woodenfloor_1.png)
  - "Pattern Pack" by Kenney  https://kenney.nl/assets/pattern-pack
      (PNG/Double/pattern_NN.png, used as wallpaper and floor tiles)

    python build_rooms.py <textures dir> <Pattern Pack>/PNG/Double <app/public/rooms>

Needs numpy and Pillow.
"""
import os, sys
import numpy as np
from PIL import Image

TEX, PAT, OUT = sys.argv[1:4]
W, H, SS = 1520, 960, 3
FOCAL = 760.0          # smaller = flatter floor
WAINSCOT, RAIL, SKIRT = 150, 9, 20

# id: wall, floor, back-edge y, side y, back-edge inset x, then the look
ROOMS = {
    'home':         ('#F4E3C9', '#D9A066', 420, 500, 120, dict(floor='boards', paper=(5, 80, -0.05))),
    'gallery':      ('#E9E4DC', '#8E5F40', 460, 530, 80,  dict(floor='planks', wainscot=False)),
    'professional': ('#C4D7DF', '#C99A6B', 440, 520, 100, dict(floor='planks', paper=(60, 110, 0.30))),
    'archive':      ('#D2C7AB', '#9C6B45', 420, 500, 140, dict(floor='planks', paper=(18, 150, -0.10), wainscot=False)),
    'lab':          ('#C6DEC9', '#B9BEC2', 440, 520, 120, dict(floor='checker', paper=(14, 110, 0.45), wainscot=False)),
    'shop':         ('#F3CDBB', '#A9744F', 440, 520, 100, dict(floor='boards', paper=(62, 120, 0.28))),
    'content':      ('#FFE7BF', '#D7A77A', 400, 460, 60,  dict(floor='planks', paper=(71, 110, 0.35))),
    'memory-lane':  ('#DCCDE8', '#B9A090', 340, 340, 0,   dict(floor='stone', paper=(34, 130, 0.25))),
}


def rgb(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)
def mix(a, b, t): return a + (np.asarray(b, np.float32) - a) * t
WHITE, BLACK = np.full(3, 255, np.float32), np.zeros(3, np.float32)


class Tex:
    """A seamless greyscale texture, sampled in world units (near-edge px)."""

    def __init__(self, path, span, contrast=1.0, norm=True):
        im = Image.open(path).convert('L')
        # resample so one world unit is ~SS texels: no blocks, little aliasing
        n = max(64, min(3072, int(span * SS)))
        im = im.resize((n, round(n * im.height / im.width)), Image.LANCZOS)
        a = np.asarray(im, np.float32) / 255.0
        if norm: a = np.clip(1.0 + (a / a.mean() - 1.0) * contrast, 0.0, 1.6)
        self.a, self.ppu = a, n / span

    def __call__(self, u, v):
        h, w = self.a.shape
        return self.a[np.mod((v * self.ppu).astype(np.int64), h), np.mod((u * self.ppu).astype(np.int64), w)]


def tex(name, span, contrast=1.0): return Tex(os.path.join(TEX, name), span, contrast)
def pattern(n, span): return Tex(os.path.join(PAT, 'pattern_%02d.png' % n), span, norm=False)


def build(rid, wall_hex, floor_hex, y0, y1, inset, look):
    wall, floor = rgb(wall_hex), rgb(floor_hex)
    # Perspective from the room's own corners: the floor edge runs from
    # (inset, y0) at the back to (0, y1) at the side.
    back_w = W - 2 * inset
    near_w = back_w + 2 * inset * (H - y0) / (y1 - y0) if inset else back_w * 2.0
    s0 = back_w / near_w                       # scale at the back wall (1 at the bottom edge)
    yh = (y0 - s0 * H) / (1 - s0)              # horizon
    cam = H - yh
    cx, xw = W / 2, near_w / 2

    plaster = tex('plaster_wall.jpg', 380, 1.4)
    panel_t = tex('wood_base.jpg', 300, 0.7)
    trim_t = tex('wood_base_sharp.jpg', 300, 1.6)
    paper = look.get('paper')
    paper_t = pattern(paper[0], paper[1]) if paper else None
    kind = look['floor']
    if kind == 'boards': floor_t = tex('wood_floor.jpg', 330, 2.2)
    elif kind == 'planks': floor_t = tex('woodenfloor_1.png', 600, 0.85)
    elif kind == 'stone': floor_t = tex('stone_patio.jpg', 420, 2.0)
    else: floor_t, check_t = tex('marble.jpg', 420, 1.2), pattern(16, 520)
    wainscot = look.get('wainscot', True)
    panel = mix(wall, WHITE, 0.45)

    def wall_rgb(a, yb):
        """Colour of the wall `a` px along and `yb` px above the floor (in
        back-wall pixels)."""
        col = wall[None, :] * plaster(a, yb)[:, None]
        if paper_t is not None:
            m = paper_t(a, yb)[:, None] * abs(paper[2])
            col = col * (1 - m) if paper[2] < 0 else col + (255 - col) * m
        if wainscot:
            low = yb < WAINSCOT
            col[low] = panel[None, :] * panel_t(a[low], yb[low])[:, None]
            rail = (yb >= WAINSCOT) & (yb < WAINSCOT + RAIL)
            col[rail] = mix(wall, BLACK, 0.16)[None, :] * trim_t(yb[rail] * 6, a[rail])[:, None]
        skirt = yb < SKIRT
        col[skirt] = mix(floor, BLACK, 0.34)[None, :] * trim_t(yb[skirt] * 6, a[skirt])[:, None]
        col[skirt & (yb > SKIRT - 3)] *= 1.12
        return col

    out = np.zeros((H * SS, W * SS, 3), np.uint8)
    xs = (np.arange(W * SS, dtype=np.float32) + 0.5) / SS
    for r0 in range(0, H * SS, 240):
        ys = (np.arange(r0, min(H * SS, r0 + 240), dtype=np.float32) + 0.5) / SS
        x, y = np.meshgrid(xs, ys)
        x, y = x.ravel(), y.ravel()
        col = np.zeros((x.size, 3), np.float32)
        side = (x < inset) | (x > W - inset)
        s_side = np.maximum(np.abs(x - cx) / xw, 1e-6)       # scale of the side wall at this x
        is_floor = np.where(side, y >= yh + cam * s_side, y >= y0)

        # floor
        f = is_floor
        s = (y[f] - yh) / cam
        fx, fz = (x[f] - cx) / s, FOCAL / s
        lum = floor_t(fx + 5000, fz)
        if kind == 'checker':
            tile = check_t(fx + 5000, fz)
            c = mix(floor, WHITE, 0.30)[None, :] * (1 - tile[:, None]) + mix(floor, BLACK, 0.10)[None, :] * tile[:, None]
        else:
            c = np.repeat(floor[None, :], lum.size, 0)
        c = c * lum[:, None]
        c *= (0.86 + 0.14 * (s - s0) / (1 - s0))[:, None]               # dimmer towards the back
        c *= (1 - 0.22 * np.exp(-(FOCAL / s0 - fz) / 26.0))[:, None]    # shadow under the back wall
        if inset:
            c *= (1 - 0.20 * np.exp(-(xw - np.abs(fx)) / 26.0))[:, None]
        col[f] = c

        # back wall
        b = ~is_floor & ~side
        c = wall_rgb(x[b] - inset, y0 - y[b])
        c *= (0.93 + 0.07 * np.clip(y[b] / max(1, y0 - WAINSCOT), 0, 1))[:, None]   # a little darker up high
        col[b] = c

        # side walls: the same wall, running towards the viewer
        w = ~is_floor & side
        sw = s_side[w]
        yb = (cam - (y[w] - yh) / sw) * s0
        along = FOCAL * (1 - s0 / sw)
        c = wall_rgb(np.where(x[w] < cx, -along, back_w + along), yb) * 0.90
        c *= (1 - 0.10 * np.exp(-along / 30.0))[:, None]                # corner shade
        col[w] = c

        out[r0:r0 + ys.size] = np.clip(col, 0, 255).astype(np.uint8).reshape(ys.size, W * SS, 3)
    im = Image.fromarray(out).resize((W, H), Image.LANCZOS)
    im.save(os.path.join(OUT, rid + '.jpg'), quality=88, optimize=True, progressive=True)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[4:]
    for rid, (wall, floor, y0, y1, inset, look) in ROOMS.items():
        if only and rid not in only: continue
        build(rid, wall, floor, y0, y1, inset, look)
        print(rid)
