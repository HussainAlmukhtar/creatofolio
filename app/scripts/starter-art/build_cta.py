"""Builds the "click to play" card that sits over the hero screen
(app/public/landing/cta-en.svg, cta-ar.svg) out of open art. Nothing is drawn
here: the script lays out Kenney's buttons and icons and sets the label.

Sources (see THIRD_PARTY_NOTICES.md):
  - "UI Pack" by Kenney (CC0)        https://kenney.nl/assets/ui-pack
      Vector/Red/button_round_depth_gradient.svg, Vector/Extra/icon_play_light.svg,
      Vector/Blue/button_rectangle_depth_gradient.svg, Font/Kenney Future.ttf
  - "Input Prompts" by Kenney (CC0)  https://kenney.nl/assets/input-prompts
      Keyboard & Mouse/Vector/mouse_left.svg
  - Lalezar (SIL OFL 1.1), for the Arabic label
      https://github.com/google/fonts/tree/main/ofl/lalezar

    python build_cta.py <UI Pack dir> <Input Prompts dir> <Lalezar-Regular.ttf> <app/public/landing>

Needs fonttools and uharfbuzz (pip install fonttools uharfbuzz). The labels
are converted to outlines, so the card looks the same on every device.
"""
import os, re, sys
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

UI, PROMPTS, ARABIC_FONT, OUT = sys.argv[1:5]
VB_W, VB_H = 570, 360          # the screen cut-out, see arcadeConfig.ts


def inner(path, uid):
    """The drawing inside a Kenney SVG, with its gradient ids made unique."""
    s = open(path, encoding='utf-8').read()
    body = s[s.index('>', s.index('<svg')) + 1:s.rindex('</svg>')]
    return re.sub(r'gradient(\d+)', lambda m: f'{uid}g{m.group(1)}', body).strip()


def outline(font_path, text, size, rtl=False):
    """Shape `text` and return (svg path data, width) at `size` px, baseline
    at y = 0."""
    data = open(font_path, 'rb').read()
    font, tt = hb.Font(hb.Face(data)), TTFont(font_path)
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    if rtl: buf.direction, buf.script, buf.language = 'rtl', 'Arab', 'ar'
    hb.shape(font, buf)
    k = size / tt['head'].unitsPerEm
    glyphs, order, x = tt.getGlyphSet(), tt.getGlyphOrder(), 0
    pen = SVGPathPen(glyphs)
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        glyphs[order[info.codepoint]].draw(
            TransformPen(pen, (k, 0, 0, -k, (x + pos.x_offset) * k, -pos.y_offset * k)))
        x += pos.x_advance
    d = re.sub(r'(\d+\.\d{2})\d+', r'\1', pen.getCommands())
    return d, x * k


def card(text, font_path, size, rtl, baseline):
    red = inner(os.path.join(UI, 'Vector/Red/button_round_depth_gradient.svg'), 'r')
    play = inner(os.path.join(UI, 'Vector/Extra/icon_play_light.svg'), 'p')
    blue = inner(os.path.join(UI, 'Vector/Blue/button_rectangle_depth_gradient.svg'), 'b')
    mouse = inner(os.path.join(PROMPTS, 'Keyboard & Mouse/Vector/mouse_left.svg'), 'm')
    d, tw = outline(font_path, text, size, rtl)

    # the round button (64 units) with the play icon (30x34) on its face
    bs = 2.3
    bx, by = (VB_W - 64 * bs) / 2, 46
    ps = 2.1
    px, py = VB_W / 2 - 30 * ps / 2 + 5, by + 30 * bs - 34 * ps / 2

    # the label: Kenney's 192x64 button, its flat middle stretched to fit
    icon, gap, pad, cap = 52, 6, 26, 40
    lw, lh = pad * 2 + icon + gap + tw, 64
    lx, ly = (VB_W - lw) / 2, 236
    ix = lx + lw - pad - icon if rtl else lx + pad
    tx = lx + pad if rtl else lx + pad + icon + gap
    mid = lw - 2 * cap
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VB_W} {VB_H}">
  <!-- "Click to play" card over the hero screen; the viewBox matches the
       screen cut-out. Built by app/scripts/starter-art/build_cta.py from
       Kenney's UI Pack and Input Prompts (CC0). -->
  <g transform="translate({bx:.1f} {by}) scale({bs})">{red}</g>
  <g transform="translate({px:.1f} {py:.1f}) scale({ps})">{play}</g>
  <svg x="{lx:.1f}" y="{ly}" width="{cap}" height="{lh}" viewBox="0 0 {cap} 64">{blue}</svg>
  <svg x="{lx + cap - 0.5:.1f}" y="{ly}" width="{mid + 1:.1f}" height="{lh}" viewBox="90 0 12 64" preserveAspectRatio="none">{blue}</svg>
  <svg x="{lx + lw - cap:.1f}" y="{ly}" width="{cap}" height="{lh}" viewBox="{192 - cap} 0 {cap} 64">{blue}</svg>
  <g transform="translate({ix:.1f} {ly + 30 - icon / 2:.1f}) scale({icon / 64})">{mouse}</g>
  <path transform="translate({tx:.1f} {ly + baseline})" fill="#FFFFFF" d="{d}"/>
</svg>
'''


if __name__ == '__main__':
    latin = os.path.join(UI, 'Font/Kenney Future.ttf')
    for lang, text, font_path, size, rtl, baseline in (
            ('en', 'CLICK TO PLAY', latin, 24, False, 39),
            ('ar', 'انقر للعب', ARABIC_FONT, 36, True, 41)):
        with open(os.path.join(OUT, f'cta-{lang}.svg'), 'w', encoding='utf-8', newline='\n') as f:
            f.write(card(text, font_path, size, rtl, baseline))
        print('cta-' + lang)
