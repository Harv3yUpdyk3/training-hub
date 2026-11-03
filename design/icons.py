# Card icons: Olympic-style solid pictograms used as CSS masks, one per card, in palette colours.
import math, urllib.parse
def uri(body, vb='0 0 24 24'):
    svg = f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='{vb}'>{body}</svg>"
    return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe=" =:/';,.-") + '")'
def star_pts(cx, cy, r, rot=0, inner=.45):
    p = []
    for k in range(10):
        a = math.radians(rot - 90 + k * 36); rr = r if k % 2 == 0 else r * inner
        p.append(f"{cx + rr * math.cos(a):.2f},{cy + rr * math.sin(a):.2f}")
    return ' '.join(p)
spokes = ''.join(f"<line x1='12' y1='12' x2='{12+8.5*math.cos(math.radians(a)):.2f}' y2='{12+8.5*math.sin(math.radians(a)):.2f}' stroke='#000' stroke-width='1.3'/>" for a in range(0, 360, 30))
cog = ''.join(f"<rect x='10.6' y='1.2' width='2.8' height='4' rx='.6' transform='rotate({a} 12 12)'/>" for a in range(0, 360, 30))
ICONS = {
  'star': f"<polygon points='{star_pts(12,12.6,11)}'/>",
  'stars': f"<polygon points='{star_pts(6,7,5,0)}'/><polygon points='{star_pts(17,9,6,15)}'/><polygon points='{star_pts(11,18.5,5,28)}'/>",
  'flame': "<path d='M12.5 1.5c1 4.2 6.5 6.4 6.5 12.4A7 7 0 0 1 5 14c0-3.2 1.6-5.3 3.3-6.6-.2 2.2.6 3.8 2 4.6C10 8.6 10.9 4.6 12.5 1.5z'/>",
  'wheel': f"<circle cx='12' cy='12' r='10' fill='none' stroke='#000' stroke-width='2.6'/><circle cx='12' cy='12' r='2.4'/>{spokes}",
  'cog': f"{cog}<circle cx='12' cy='12' r='8.2'/><circle cx='12' cy='12' r='3.2' fill='#fff'/>",
  'medal': "<path d='M6 1h4l3 7H9zM14 1h4l-3 7h-4z'/><circle cx='12' cy='15.5' r='7.5'/>",
  'stopwatch': "<rect x='9.5' y='0.8' width='5' height='2.6' rx='1'/><rect x='18' y='4' width='3' height='2.4' rx='1' transform='rotate(45 19.5 5.2)'/><path fill-rule='evenodd' d='M12 3.8a9.6 9.6 0 1 1 0 19.2 9.6 9.6 0 0 1 0-19.2zm-1.1 4.4v6.6l4.6 2.7 1.1-1.8-3.6-2.1V8.2z'/>",
  'heart': "<path d='M12 21.5S2 15.2 2 8.4A5.4 5.4 0 0 1 12 5.6a5.4 5.4 0 0 1 10 2.8c0 6.8-10 13.1-10 13.1z'/>",
  'sun': "<circle cx='12' cy='12' r='5.2'/>" + ''.join(f"<rect x='11' y='0.6' width='2' height='4.2' rx='1' transform='rotate({a} 12 12)'/>" for a in range(0, 360, 45)),
  'calendar': "<path fill-rule='evenodd' d='M3 4.5h18a1 1 0 0 1 1 1V21a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1zM4 9.5V20h16V9.5z'/><rect x='6' y='1.5' width='2.4' height='5' rx='1'/><rect x='15.6' y='1.5' width='2.4' height='5' rx='1'/><rect x='6' y='12' width='3' height='3'/><rect x='10.5' y='12' width='3' height='3'/><rect x='15' y='12' width='3' height='3'/><rect x='6' y='16.2' width='3' height='3'/><rect x='10.5' y='16.2' width='3' height='3'/>",
  'podium': "<rect x='8.5' y='7' width='7' height='15'/><rect x='1.5' y='11.5' width='7' height='10.5'/><rect x='15.5' y='14.5' width='7' height='7.5'/><polygon points='" + star_pts(12, 3.4, 3, 0) + "'/>",
  'road': "<path d='M9.5 1h5l6 22h-17z'/><rect x='11.2' y='4' width='1.6' height='3' fill='#fff'/><rect x='11.1' y='10' width='1.8' height='3.6' fill='#fff'/><rect x='11' y='17' width='2' height='4.4' fill='#fff'/>",
  'crown': "<path d='M2 7l5 4.5L12 3l5 8.5L22 7l-2 12H4z'/><rect x='4' y='20' width='16' height='2.4' rx='.6'/>",
  'torch': "<path d='M12.6 1c.8 2.8 4.4 4.2 4.4 8.2a5 5 0 0 1-10 .1c0-2.2 1.1-3.6 2.3-4.5-.1 1.5.4 2.6 1.4 3.1-.6-2.6 0-5.3 1.9-6.9z'/><path d='M7 12.5h10l-3 10.5h-4z'/>",
  'bolt': "<path d='M14 1 4 13.5h7L9.5 23 20 10h-7z'/>",
  'mountain': "<path d='M0 22 9 6l4.5 7 3-4.4L24 22z'/>",
  'bars': "<rect x='2' y='13' width='4' height='9' rx='1'/><rect x='8' y='8' width='4' height='14' rx='1'/><rect x='14' y='11' width='4' height='11' rx='1'/><rect x='20' y='4' width='3' height='18' rx='1'/>",
  'flag': "<rect x='3' y='1.5' width='2.2' height='21' rx='1'/><path d='M5.2 2.5h15v11h-15z' fill-opacity='1'/><path d='M5.2 2.5h3.75v3.7H5.2zM12.7 2.5h3.75v3.7H12.7zM8.95 6.2h3.75v3.6H8.95zM16.45 6.2h3.75v3.6h-3.75zM5.2 9.8h3.75v3.7H5.2zM12.7 9.8h3.75v3.7H12.7z' fill='#fff'/>",
}
# Cut-outs (drawn with fill='#fff') become holes: the solid shapes go through an SVG mask
# that is white everywhere except those shapes.
import re
for k, v in list(ICONS.items()):
    cuts = re.findall(r"<[^<>]*fill='#fff'[^<>]*/>", v)
    if not cuts: continue
    solid = v
    for c in cuts: solid = solid.replace(c, '')
    holes = ''.join(c.replace("fill='#fff'", "fill='#000'") for c in cuts)
    ICONS[k] = f"<mask id='h'><rect width='24' height='24' fill='#fff'/>{holes}</mask><g mask='url(#h)'>{solid}</g>"
# card -> (icon, colour)
CARDS = {
  'recap-card': ('flame', 'var(--orange)'), 'weather-card': ('sun', 'var(--copper-hi)'), 'cumulative-card': ('road', 'var(--sky)'),
  'calendar-card': ('calendar', 'var(--amethyst)'), 'last4-card': ('stopwatch', 'var(--stone-hi)'), 'week-strip-card': ('wheel', 'var(--sky)'),
  'eddington-card': ('star', 'var(--copper-hi)'), 'season-totals': ('podium', 'var(--copper-hi)'),
  'plan-card': ('torch', 'var(--orange)'), 'zones-card': ('heart', 'var(--cerise)'), 'todo-card': ('cog', 'var(--copper-hi)'),
  'load-card': ('bolt', 'var(--copper-hi)'), 'fitness-card': ('heart', 'var(--cerise)'), 'zone-time-card': ('stopwatch', 'var(--sky)'),
  'ride-detail-card': ('wheel', 'var(--sky)'), 'recent-card': ('road', 'var(--stone-hi)'), 'month-report-card': ('calendar', 'var(--amethyst)'),
  'weekly-card': ('bars', 'var(--copper-hi)'), 'bests-card': ('medal', 'var(--copper-hi)'), 'garage-card': ('cog', 'var(--sky)'),
  'upkeep-card': ('crown', 'var(--copper-hi)'), 'legends-card': ('crown', 'var(--copper-hi)'), 'defense-card': ('stars', 'var(--amethyst)'),
  'hascall-card': ('mountain', 'var(--orange)'), 'most-ridden-card': ('flag', 'var(--cream)'), 'prs-card': ('medal', 'var(--copper-hi)'),
  'colombier-card': ('mountain', 'var(--amethyst)'), 'tourmalet-card': ('mountain', 'var(--amethyst)'), 'climb-ready-card': ('flag', 'var(--cream)'),
  'climb-weeks-card': ('bars', 'var(--amethyst)'), 'phase-card': ('torch', 'var(--orange)'), 'lastweek-card': ('podium', 'var(--sky)'), 'climb-sim-card': ('stopwatch', 'var(--orange)'),
  'tours-card': ('wheel', 'var(--stone-hi)'), 'year-card': ('crown', 'var(--copper-hi)'), 'phases-card': ('stars', 'var(--copper-hi)'),
}
def css():
    out = ["\n/* Card icons: a different Olympic-style pictogram per card (star, flame, wheel, medal...) */", ":root {"]
    for k, v in ICONS.items():
        out.append(f"  --ic-{k}: {uri(v)};")
    out.append("}")
    for cid, (ic, col) in CARDS.items():
        sel = f"#{cid} h2::before" if cid != 'season-totals' else "#season-totals h2::before"
        out.append(f"{sel} {{ -webkit-mask-image: var(--ic-{ic}); mask-image: var(--ic-{ic}); background: {col}; width: 17px; height: 17px; }}")
    return '\n'.join(out) + '\n'
