"""Builds the landing hero's built-in arcade machine, app/public/landing/machine.png,
from the arcade-machine model in Kenney's "Mini Arcade" (CC0,
https://kenney.nl/assets/mini-arcade), rendered front-on by render_obj.py.

The model is reshaped a little first so the game fits its screen: the screen
is made exactly 1520:960, the control panel is lowered so the joysticks don't
cover it, and the marquee and base are shortened. The screen is then cut out
(transparent) so the live game shows through. The script prints the `canvas`
and `screen` values to put in DEFAULT_ARCADE.machine (src/data/arcadeConfig.ts).

    python build_landing.py "<Mini Arcade>/Models/OBJ format" <app/public/landing>
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_obj import render

SRC, OUT = sys.argv[1], sys.argv[2]
ASPECT = 1520 / 960
SCREEN = (222, 222, 234)          # the screen face's colour in the model's palette
PITCH = 9
HOLE_W = 1140                     # screen cut-out width in the saved image (2x of 570)

def warp(stretch):
    def f(V):
        y, z = V[:, 1].copy(), V[:, 2]
        # lower the control panel + joysticks (front of the cabinet, y 0.15..0.40)
        front = (z > 0.16) & (y > 0.15) & (y <= 0.4001)
        y[front] = 0.15 + (y[front] - 0.15) * 0.66
        # piecewise heights: base, body, screen, marquee
        out = np.where(y <= 0.15, y * 0.55,
              np.where(y <= 0.332, 0.0825 + (y - 0.15),
              np.where(y <= 0.509, 0.2645 + (y - 0.332) * stretch,
                       0.2645 + 0.177 * stretch + (y - 0.509) * 0.62)))
        V[:, 1] = out
        return V
    return f

def measure(stretch, height):
    im, (x0, y0, x1, y1) = render(os.path.join(SRC, 'arcade-machine.obj'), height=height, yaw=0, pitch=PITCH, warp=warp(stretch), pick=SCREEN, pad=4)
    return im, (x0, y0, x1, y1)

# 1) find the stretch that gives the screen the game's shape (a touch taller, to be safe)
stretch = 1.0
for _ in range(4):
    _, (x0, y0, x1, y1) = measure(stretch, 500)
    stretch *= ((x1 - x0) / (y1 - y0)) / ASPECT * 1.012
# 2) render at the size that makes the screen HOLE_W wide
_, (x0, y0, x1, y1) = measure(stretch, 500)
im, (x0, y0, x1, y1) = measure(stretch, round(500 * HOLE_W / (x1 - x0)))
im = im.crop((0, 0, im.width, im.height))
hx0 = round((x0 + x1) / 2 - HOLE_W / 2); hy0 = round(y0 + ((y1 - y0) - HOLE_W / ASPECT) / 2)
hole = (hx0, hy0, hx0 + HOLE_W, hy0 + round(HOLE_W / ASPECT))
a = im.getchannel('A'); ImageDraw.Draw(a).rectangle(hole, fill=0); im.putalpha(a)
box = im.getbbox(); im = im.crop(box); hole = tuple(v - box[i % 2] for i, v in enumerate(hole))
os.makedirs(OUT, exist_ok=True)
im.save(os.path.join(OUT, 'machine.png'), optimize=True)
W, H = im.size
print('saved', (W, H), 'hole', hole, 'face', (round(x0), round(y0), round(x1), round(y1)))
print('canvas: { w: %d, h: %d }' % (W // 2, H // 2))
print('screen: { x: %.2f, y: %.2f, w: %.2f }' % (hole[0] / W * 100, hole[1] / H * 100, HOLE_W / W * 100))
