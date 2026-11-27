"""Builds the starter avatar walk sheets in app/public/avatar/seed/.

Each sheet is 7 cells of 480x560 (idle + 6 walk poses), one sheet per wardrobe
item, assembled from Kenney's "Modular Characters" parts (CC0,
https://kenney.nl/assets/modular-characters).

    python build_sheets.py "<Modular Characters>/PNG" <app/public/avatar/seed>
"""
import sys, os, math
from PIL import Image
SRC, OUT = sys.argv[1], sys.argv[2]
CW, CH, N = 480, 560, 7
SC = 0.86            # native part px -> cell px
CX, TOP = 240, 46    # rig origin in the cell (centre x, top of head)

def load(rel): return Image.open(os.path.join(SRC, rel)).convert('RGBA')
def flip(im): return im.transpose(Image.FLIP_LEFT_RIGHT)

# poses: (bodyDy, legL lift, legR lift, legL rot, legR rot, armL rot, armR rot)
POSES = [
 (0,   0,  0,   0,  0,   0,   0),
 (-2, 12,  0,   0,  0,   6,   6),
 (-7, 24,  0,   0,  0,  11,  11),
 (-3,  8,  0,   0,  0,   4,   4),
 (-2,  0, 12,   0,  0,  -6,  -6),
 (-7,  0, 24,   0,  0, -11, -11),
 (-3,  0,  8,   0,  0,  -4,  -4),
]

class Cell:
    def __init__(s): s.im = Image.new('RGBA', (CW*2, CH*2), (0,0,0,0))  # 2x supersample
    def put(s, part, x, y, rot=0, pivot=(0,0)):
        """x,y = part top-left in native rig units (x from centre, y from head top);
        rot in degrees (counter-clockwise) about pivot (native, relative to the part)."""
        k = SC*2
        p = part.resize((max(1,round(part.width*k)), max(1,round(part.height*k))), Image.LANCZOS)
        px, py = round(CX*2 + x*k), round(TOP*2 + y*k)
        layer = Image.new('RGBA', s.im.size, (0,0,0,0)); layer.paste(p, (px, py))
        if rot: layer = layer.rotate(rot, resample=Image.BICUBIC, center=(px+pivot[0]*k, py+pivot[1]*k))
        s.im = Image.alpha_composite(s.im, layer)
    def done(s): return s.im.resize((CW, CH), Image.LANCZOS)

# rig layout (native units; x from centre, y from head top). Limb art is
# drawn for the viewer's RIGHT side; the left side is mirrored.
HEAD=(-86,0); NECK=(-48,150)
TORSO=(-76,172); HIP=(-76,318)
ARM=(44,180); ARM_PIV=(14,20); HAND=(128,84)
LEG=(4,336); SHOE=(14,150); ARM_BASE=-24

def sheet(draw):
    out = Image.new('RGBA', (CW*N, CH), (0,0,0,0))
    for i, pose in enumerate(POSES):
        c = Cell(); draw(c, pose); out.paste(c.done(), (i*CW, 0))
    return out

def side_put(c, img, side, x, y, rot=0, pivot=(0,0)):
    if side > 0: c.put(img, x, y, rot, pivot)
    else: c.put(flip(img), -x-img.width, y, -rot, (img.width-pivot[0], pivot[1]))

def legs(c, pose, img, dx=0, dy=0, shoe=False):
    bd, ll, lr = pose[0], pose[1], pose[2]
    for side, lift in ((-1, ll), (1, lr)):
        if shoe: side_put(c, img, side, LEG[0]+SHOE[0], LEG[1]+SHOE[1]-lift)
        else:    side_put(c, img, side, LEG[0]+dx, LEG[1]+dy-lift)

def arms(c, pose, img, hand=None):
    bd, al, ar = pose[0], pose[5], pose[6]
    for side, rot in ((-1, al), (1, ar)):
        im = img
        if hand is not None:
            im = Image.new('RGBA', (HAND[0]+hand.width, max(img.height, HAND[1]+hand.height)), (0,0,0,0))
            im.alpha_composite(img); im.alpha_composite(hand, HAND)
        side_put(c, im, side, ARM[0], ARM[1]+bd, ARM_BASE + rot*side, ARM_PIV)

def skin_shape(shape, ref):
    """A part's silhouette filled with the skin colour (the body's own torso/hips)."""
    col = ref.resize((1,1), Image.BOX).getpixel((0,0))
    px = ref.getpixel((ref.width//2, ref.height//2))
    out = Image.new('RGBA', shape.size, px[:3]+(255,)); out.putalpha(shape.getchannel('A'))
    return out

# The nose belongs to the BODY sheet, not the face: the body is the layer
# that takes the visitor's skin tone, so the nose changes colour with it.
# Kenney's ready-made faces include a nose in a fixed skin colour that nothing
# else in the face uses, so face() lifts it out by colour and lines the face
# up on the body's nose.
NOSE = (-11, 104)     # rig position of the body's nose (tintNNose3, 22x15)
NOSE_COLOURS = ((245, 210, 157), (231, 195, 140))

def body(tint):
    p = 'Skin/Tint %d/tint%d_' % (tint, tint)
    head, neck, arm, hand, leg = [load(p+n+'.png') for n in ('head','neck','arm','hand','leg')]
    nose = load('Face/Nose/Tint %d/tint%dNose3.png' % (tint, tint))
    torso = skin_shape(load('Shirts/Blue/blueShirt3.png'), neck)
    hip = skin_shape(load('Pants/Blue 1/pantsBlue13.png'), neck)
    def d(c, pose):
        bd = pose[0]
        legs(c, pose, leg)
        c.put(hip, HIP[0], HIP[1]+bd)
        arms(c, pose, arm, hand)
        c.put(torso, TORSO[0], TORSO[1]+bd)
        c.put(neck, NECK[0], NECK[1]+bd)
        c.put(head, HEAD[0], HEAD[1]+bd)
        c.put(nose, NOSE[0], NOSE[1]+bd)
    return sheet(d)

def face(n):
    f = load('Face/Completes/face%d.png' % n)
    px, xs, ys = f.load(), [], []
    for y in range(f.height):
        for x in range(f.width):
            r, g, b, a = px[x, y]
            if a and any(abs(r-c[0]) + abs(g-c[1]) + abs(b-c[2]) < 36 for c in NOSE_COLOURS):
                px[x, y] = (r, g, b, 0); xs.append(x); ys.append(y)
    # Place the face so its own nose sat where the body's nose is (centres match).
    x = NOSE[0] + 11 - (min(xs) + max(xs) + 1) / 2
    y = NOSE[1] + 7.5 - (min(ys) + max(ys) + 1) / 2
    return sheet(lambda c, pose: c.put(f, x, y + pose[0]))

def hair(name, dy=0):
    h = load('Hair/Brown 1/brown1%s.png' % name)
    return sheet(lambda c, pose: c.put(h, -h.width/2, -26+dy+pose[0]))

def shirt(n, sleeve):
    t = load('Shirts/Blue/blueShirt%d.png' % n); a = load('Shirts/Blue/blueArm_%s.png' % sleeve)
    def d(c, pose):
        arms(c, pose, a)
        c.put(t, TORSO[0], TORSO[1]+pose[0])
    return sheet(d)

def pants(n, length):
    hip = load('Pants/Blue 1/pantsBlue1%d.png' % n); l = load('Pants/Blue 1/pantsBlue1_%s.png' % length)
    def d(c, pose):
        legs(c, pose, l, dx=-6, dy=-4)
        c.put(hip, HIP[0], HIP[1]+pose[0])
    return sheet(d)

def shoes(n):
    s = load('Shoes/Brown 1/brownShoe%d.png' % n)
    return sheet(lambda c, pose: legs(c, pose, s, shoe=True))

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    made = {}
    made['body-classic'] = body(1)
    for i in (1,2,3,4): made['eyes-%d' % i] = face(i)
    for nm in ('Man1','Man2','Man3','Man5','Man6','Man8','Woman1','Woman2','Woman4','Woman6'): made['hair-'+nm.lower()] = hair(nm)
    for key,(n,sl) in {'tee':(1,'short'),'longsleeve':(2,'long'),'vest':(3,'shorter'),'shirt':(5,'long'),'polo':(6,'short'),'top':(8,'shorter')}.items(): made['shirt-'+key] = shirt(n, sl)
    for key,(n,ln) in {'long':(1,'long'),'cropped':(2,'short'),'shorts':(3,'shorter'),'belted':(4,'long')}.items(): made['pants-'+key] = pants(n, ln)
    for i in (1,2,3,4,5): made['shoes-%d' % i] = shoes(i)
    for k, im in made.items(): im.save(os.path.join(OUT, k+'.png'), optimize=True)
    print(len(made), 'sheets')
