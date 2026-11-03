# Builds ../olympic96.css from theme.tmpl.css (+ card icons from icons.py). Run: python3 design/gen.py
import os, sys, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__))
def uri(svg): return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe=" =:/';,.-") + '")'
BIKE = ("<g fill='{c}' stroke='{c}' stroke-linecap='round' stroke-linejoin='round'>"
  "<circle cx='10' cy='28' r='7.5' fill='none' stroke-width='3.6'/><circle cx='38' cy='28' r='7.5' fill='none' stroke-width='3.6'/>"
  "<path d='M10 28 19 17h13l6 11M19 17l4 11 9-11' fill='none' stroke-width='2.4'/><circle cx='35' cy='5.5' r='4' stroke='none'/>"
  "<path d='M16 15c3-6 9-9 16-8l1 4c-6 0-10 2-13 6z' stroke='none'/><path d='M31 9l5 7' fill='none' stroke-width='3.4'/>"
  "<path d='M18 15l8 5-3 7' fill='none' stroke-width='4.2'/></g>")
MTN = ("<path d='M0 32 17 4l8 12 6-8 17 24z' fill='{c}'/><path d='M12.6 11.2 17 4l4.6 7-2.6 2.4-2-2.6-2.2 2.6z' fill='{s}'/>"
  "<path d='M27.6 12.6 31 8l3.6 5.2-1.8 1.4-1.6-1.6-1.6 1.6z' fill='{s}'/>")
tile = ("<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'>"
  "<g transform='translate(14 18)' opacity='.07'>" + MTN.format(c='#f4ead2', s='#f4ead2') + "</g>"
  "<g transform='translate(96 100)' opacity='.07'>" + BIKE.format(c='#f4ead2') + "</g></svg>")
bike = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 38'>" + BIKE.format(c='#000') + "</svg>"
mtn = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 32'>" + MTN.format(c='#000', s='#000') + "</svg>"
css = open(os.path.join(HERE, 'theme.tmpl.css')).read()
css = css.replace('@TILE@', uri(tile)).replace('@BIKE@', uri(bike)).replace('@MTN@', uri(mtn))
sys.path.insert(0, HERE); import icons
css += icons.css()
open(os.path.join(HERE, '..', 'olympic96.css'), 'w').write(css)
