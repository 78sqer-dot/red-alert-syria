"""Generates the Red Alert Syria logo (SVG, text converted to paths) + PNG icons."""
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import subprocess, os, sys
SRC = '/workspace/data/montserrat.ttf'
def font(w):
    f = TTFont(SRC); return instantiateVariableFont(f, {'wght': w}, inplace=False)
def text_path(f, text, x, baseline, size, tracking=0):
    gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f['head'].unitsPerEm; s = size / upm
    pen = SVGPathPen(gs); cx = x
    for ch in text:
        g = cmap[ord(ch)]
        tp = TransformPen(pen, (s, 0, 0, -s, cx, baseline))
        gs[g].draw(tp); cx += gs[g].width * s + tracking
    return pen.getCommands(), cx - tracking
bold, light, semi = font(800), font(300), font(600)
RED = '#ED1C24'
def icon_group(ox, oy, S=200, bg=RED):
    k = S / 200
    c = (ox + S, oy + S)
    def circ(r, fill): return f'<circle cx="{c[0]:.1f}" cy="{c[1]:.1f}" r="{r*k:.1f}" fill="{fill}"/>'
    return (f'<clipPath id="ic{ox:.0f}"><rect x="{ox}" y="{oy}" width="{S}" height="{S}"/></clipPath>'
            f'<g clip-path="url(#ic{ox:.0f})"><rect x="{ox}" y="{oy}" width="{S}" height="{S}" fill="#fff"/>'
            + circ(184, bg) + circ(162, '#fff') + circ(120, bg) + circ(99, '#fff') + circ(58, bg) +
            f'<rect x="{ox+150*k:.1f}" y="{oy+148*k:.1f}" width="{50*k:.1f}" height="{52*k:.1f}" fill="#fff"/>'
            f'<rect x="{ox+164*k:.1f}" y="{oy+162*k:.1f}" width="{22*k:.1f}" height="{38*k:.1f}" fill="{bg}"/>'
            f'<polygon points="{ox+22*k:.1f},{oy+22*k:.1f} {ox+62*k:.1f},{oy+22*k:.1f} {ox+22*k:.1f},{oy+62*k:.1f}" fill="{bg}"/></g>')
# --- wordmark 880x372
W, H = 880, 372
ox, oy = 112, 86
red_p, red_end = text_path(bold, 'RED', 372, 168, 112, 2)
alert_p, alert_end = text_path(light, 'ALERT', 368, 286, 116, 4)
syr_p, syr_end = text_path(semi, 'SYRIA', 0, 0, 34, 7)
tag_w = syr_end + 34; tag_x = red_end + 22; tag_y = 104; tag_h = 56
syr_p, _ = text_path(semi, 'SYRIA', tag_x + 17, tag_y + 40, 34, 7)
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="Red Alert Syria">'
       f'<rect width="{W}" height="{H}" fill="{RED}"/>' + icon_group(ox, oy) +
       f'<rect x="338" y="{oy}" width="7" height="200" fill="#fff"/>'
       f'<path d="{red_p}" fill="#fff"/><path d="{alert_p}" fill="#fff"/>'
       f'<rect x="{tag_x:.1f}" y="{tag_y}" width="{tag_w:.1f}" height="{tag_h}" rx="8" fill="#fff"/>'
       f'<path d="{syr_p}" fill="{RED}"/></svg>')
# crop width to content
total_w = max(alert_end, tag_x + tag_w) + 112
svg = svg.replace(f'viewBox="0 0 {W} {H}" width="{W}"', f'viewBox="0 0 {total_w:.0f} {H}" width="{total_w:.0f}"').replace(f'<rect width="{W}"', f'<rect width="{total_w:.0f}"')
open('public/img/logo-wordmark.svg', 'w').write(svg)
# --- square icon (favicon / app icon)
S = 512; pad = 92
isvg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">'
        f'<rect width="{S}" height="{S}" rx="96" fill="{RED}"/>' + icon_group(pad, pad, S - 2 * pad) + '</svg>')
open('public/img/icon.svg', 'w').write(isvg)
isvg_sq = isvg.replace('rx="96" ', '')
open('/tmp/icon-sq.svg', 'w').write(isvg_sq)
# --- Open Graph image 1200x630
sub_p, sub_end = text_path(semi, 'LIVE ALERTS MAP', 0, 0, 30, 9)
og_w, og_h = 1200, 630
scale = 0.95
gx = (og_w - total_w * scale) / 2; gy = 120
sub_x = (og_w - sub_end) / 2
sub_p, _ = text_path(semi, 'LIVE ALERTS MAP  ·  SYRIA', 0, 0, 30, 9)
sub_w = _
sub_p, _ = text_path(semi, 'LIVE ALERTS MAP  ·  SYRIA', (og_w - sub_w) / 2, 548, 30, 9)
inner = svg.split('>', 1)[1].rsplit('</svg>', 1)[0]
og = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {og_w} {og_h}" width="{og_w}" height="{og_h}">'
      f'<rect width="{og_w}" height="{og_h}" fill="{RED}"/><g transform="translate({gx:.1f},{gy}) scale({scale})">{inner}</g>'
      f'<rect x="{(og_w-80)/2}" y="490" width="80" height="4" fill="#fff" opacity=".7"/><path d="{sub_p}" fill="#fff" opacity=".92"/></svg>')
open('/tmp/og.svg', 'w').write(og)
print('ok', total_w)
