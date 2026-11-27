"""Builds the starter room elements in app/public/elements/.

Furniture: models from Kenney's "Furniture Kit" (CC0,
https://kenney.nl/assets/furniture-kit) rendered front-on by render_obj.py, so
they are sharp at any size. The NPC is one frame of the starter character
(Kenney "Modular Characters", see ../avatar-seed/). The small SVG objects
(frame, clock, sign, ...) are Microsoft Fluent Emoji, flat style (MIT,
https://github.com/microsoft/fluentui-emoji), copied unchanged.

    python build_elements.py "<Furniture Kit>/Models/OBJ format" <fluent-emoji flat svg dir> <app/public/elements> [<app/public/avatar/seed>]
"""
import os, shutil, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_obj import render

SRC, FLUENT, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
SEED = sys.argv[4] if len(sys.argv) > 4 else os.path.join(os.path.dirname(os.path.normpath(OUT)), 'avatar', 'seed')

# element id -> (Kenney model, rendered height in px, camera pitch)
FURNITURE = {
    'door': ('doorwayFront', 520, 6), 'archway': ('doorwayOpen', 520, 6),
    'bookshelf': ('bookcaseClosedWide', 460, 12), 'desk': ('desk', 300, 12),
    'chair': ('chairDesk', 380, 12), 'sofa': ('loungeSofa', 300, 12),
    'armchair': ('loungeChair', 300, 12), 'table': ('tableCoffee', 190, 14),
    'computer': ('computerScreen', 260, 8), 'tv': ('televisionVintage', 240, 10),
    'lamp': ('lampRoundFloor', 520, 8), 'plant': ('pottedPlant', 400, 10),
    'chest': ('cardboardBoxClosed', 240, 12), 'box': ('cardboardBoxOpen', 240, 12),
    'rug': ('rugRound', 190, 38), 'shelf': ('bookcaseOpen', 520, 10),
}
# element id -> Fluent Emoji (flat) file
EMOJI = {
    'frame': 'framed_picture', 'clock': 'mantelpiece_clock', 'noteboard': 'clipboard',
    'sign': 'placard', 'easel': 'artist_palette', 'window': 'window', 'trophy': 'trophy',
    'microscope': 'microscope', 'camera': 'camera', 'books': 'books', 'briefcase': 'briefcase',
    'shopping': 'shopping_bags', 'rocket': 'rocket', 'lightbulb': 'light_bulb',
    'envelope': 'envelope', 'joystick': 'joystick',
}

def mascot():
    cell = Image.new('RGBA', (480, 560), (0, 0, 0, 0))
    for n in ('body-classic', 'shoes-3', 'pants-long', 'shirt-longsleeve', 'eyes-4', 'hair-woman2'):
        cell.alpha_composite(Image.open(os.path.join(SEED, n + '.png')).convert('RGBA').crop((0, 0, 480, 560)))
    return cell.crop(cell.getbbox())

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, (model, h, pitch) in FURNITURE.items():
        im = render(os.path.join(SRC, model + '.obj'), height=h, yaw=180, pitch=pitch)
        im.save(os.path.join(OUT, name + '.png'), optimize=True); print(name, 'png', im.width, im.height)
    im = mascot(); im.save(os.path.join(OUT, 'mascot.png'), optimize=True); print('mascot', 'png', im.width, im.height)
    for name, f in EMOJI.items():
        shutil.copyfile(os.path.join(FLUENT, f + '_flat.svg'), os.path.join(OUT, name + '.svg')); print(name, 'svg', 32, 32)
