# DESIGN.md: Will's Road Book (Tour de France 2027)

This is the Road Book's design system, written in the Awesome DESIGN.md format. Anyone, person or AI agent, who changes how the Road Book looks reads this first. Will's own choices are pinned here, and they win over generic design advice. The Training Hub has its own, different system in `../DESIGN.md`. Don't mix the two.

## 1. Visual theme

The look is the Tour de France itself: race jerseys, the tricolore and stage profiles. It's a road book for a three-week van trip in July 2027 to follow the race from the roadside, with the van, stages, rides, bookings and budget. The mood is bold and sunny, like a race-day poster, but it is a working tool first. Will mostly uses it on a Samsung phone in Chrome, inside Home Base. Desktop gets a richer layer on top.

## 2. Colour palette and roles

| Token | Hex | Role |
| --- | --- | --- |
| `--jaune` | #FFD100 | Yellow jersey. Primary accent, ride days, "today", the next-up dot, the selected tab |
| `--sprint` / `--vert` | #00A859 | Green jersey. Booked nights (hotel and campsite), flat stages |
| `--pois` / `--mtn` | #EF4135 | Polka-dot red. Mountain stages, risks. It always appears as **red-and-white polka dots** (`url(#pois)` or a radial gradient), never as a flat red fill |
| `--blanc` | #ffffff | White jersey, roadside nights, rest days |
| `--fr-blue` / `--fr-red` | tricolore | Only in the 4px stripe under the top bar |
| `--bar` | #1c2024 / #0b0d0f | Top bar, tab bar, dark pills |
| `--rest` | grey | Rest and travel days |

Rules:
- Colour carries meaning: the stage type (mountain, hilly, flat, time trial, rest), whether a night is booked, a risk, or today. If a colour has no meaning, use neutral ink or grey.
- Anything red is polka dot. Anything that would be orange becomes yellow.
- Solid green means booked. The icon tells a hotel (bed) from a campsite (tent).
- On the green and yellow jersey colours, text is dark ink (#0b0d0f). White on #00A859 fails contrast.
- No rooster, no white background behind the official route map, and no purple.

## 3. Typography

- Display: Barlow Condensed (fallback Arial Narrow), 700, often uppercase. Used for stage titles, the hero and big numbers.
- Text: the system sans at 14–16px.
- Mono: used for times, distances, dates and money in lists and tables.
- Figures: tabular numerals everywhere (`body{font-variant-numeric:tabular-nums}`), so times and amounts line up.
- Size floor: 11px for any label, chip or calendar cell, and 13px for sentences. In tight phone cells, use condensed display type rather than going smaller.
- Clock times are 12-hour am/pm on screen. The data in the file stays 24-hour.

## 4. Components

- **Day strip:** a single scrolling row of day buttons with a stage-type bar, the same on phone and desktop. No side list and no stacked grid; Will rejected both.
- **Day page:** layered-peaks header in the stage-type colour, then the title and chips, "At your spot" times, the schedule, drive cards with Navigate, the Sleep card (booked shows green with ✓), rides, and the stage profile at the bottom.
- **Nights calendar:** a 7-column July grid. Booked is solid green, roadside is white, "on a climb" is polka dot, and not booked is white with a dashed border.
- **Stat tiles:** four tiles on Home (nights booked, km, left to pay, stages). The icon is coloured only when the colour means something.
- **Next-up pill:** a black, Dynamic Island style pill. It floats above the tab bar on phone and docks in the top bar on desktop. Tap it to open the Today card.
- **Chips:** small and uppercase, coloured by stage type, and only inside rows or headers.
- **Buttons:** dark fill for Navigate, yellow for ride links, outlined for the rest.
- **No cards inside cards.** The desktop route panel inside the map is the one exception.

## 5. Layout

- Phone first: 16px gutters, one column, nothing scrolls sideways, and tap targets of 44px. Lone links get 12px of extra hit area above and below.
- Phone navigation is a bottom tab bar (Home, Days, Rides, Bookings, Budget, Guide). It slides away while you scroll down a page and comes back when you scroll up, at the top, or at the end.
- Desktop (1024px or wider, with a mouse, and motion allowed): the page is 1280px wide and adds the desktop layer (see 7).

## 6. Depth and elevation

- Surfaces separate by a step in tone and a 1px line. Cards get at most one soft shadow.
- Floating things are the next-up pill, tooltips and lightboxes.
- Layered peaks appear only as day headers and in the hero. Never use them as a repeating background.

## 7. Motion

- Phone: numbers roll up once, the stage profile draws itself once, the tab pill slides, the Today card has a slow yellow edge glow, title letters drop in once, and jersey sparks show when you tick something.
- Desktop only:
  - Vanta fog sky in the hero.
  - Lenis and GSAP scroll-driven route: the van drives the official map.
  - Tilt and spotlight on cards.
  - Hover tooltips on days and stats.
  - Drag-to-fling day strip.
  - Stage-profile cursor trail on the hero.
- Everything is off under reduced motion. Don't add a new effect without asking Will. Ideas go to the enhancement plan, and Will picks.

## 8. Do and don't

Do:
- Use the official letour.fr route map for any route graphic. It stays inside the locked Road Book and never goes on a public page.
- Lock in bookings everywhere once they're made: the Sleep card, the green night, Bookings and Budget.
- Show real times, distances and money, lined up.

Don't:
- No self-drawn route map in place of the official one.
- No flat red, no orange, no rooster, no purple-to-blue gradients, no gradient text.
- No grey text on coloured fills, and no text under 11px.
- No left-hand day list and no stacked day grid on desktop.
- No booking numbers or addresses on the public Family View, only towns.

## 9. Responsive behaviour

| Width | Layout |
| --- | --- |
| up to 640px | Bottom tab bar (hides on scroll down), pill above it, condensed calendar names |
| 641px and up | Tabs in the top bar with a sliding pill |
| 1024px and up, mouse, motion allowed | Desktop layer: `fxdesk` class, wide page, effects in section 7 |

## 10. Agent prompt guide

- The source is `/mnt/project-files/tdf-2027/road-book.html` in the project files. Other threads edit it too, so always edit the file on disk fresh.
- Build the Home Base copy with `python3 build.py ../road-book.html <training-hub>/road-book --password-file password.txt --hub`, run from `tdf-2027/app/`. Never commit `password.txt` or `guest-password.txt`.
- Effects are appended blocks at the end of the file:
  - `fx`: headers, rolling numbers, tab pill, glow, profile, View Transitions.
  - `fx2`: hero, route reveal, sparks.
  - `fx3`: desktop layer.
  - `fx4`: pill, drag strip, tooltips, trail.
  - `fx5`: polish pass and app rules.

  Class names that already exist (`.ch`, `.open`) collide, so prefix new ones.
- Don't bump `sw.js` for Road Book changes.
- Test at 360px and 412px (no sideways scroll), and at 1280px, in light and dark mode.
- Feature ideas go in the Road Book enhancement plan (Claude Doc), in batches, one PR per batch, based on `main`. Never stack PRs.
