# DESIGN.md: Will's Training Hub

The design system for the hub, in the Awesome DESIGN.md format. Anyone (or any AI agent) changing the hub's look reads this first. Will's own choices are pinned here and win over generic design advice.

## 1. Visual theme

A cycling training app inspired by the Atlanta 1996 Centennial Olympics poster: a deep green field, a metallic copper-gold frame, and three stars in gold, purple and blue. Bold, uppercase block type and Olympic-style pictograms (cyclist, mountain, star, flame, wheel, medal). Dark, calm and confident, never neon.

It is an app screen that Will works in every day, mostly on an Android phone as an installed app. A desktop browser gets a wider layout and extra motion. The phone app stays lean.

## 2. Colour palette and roles

Will's palette. Blue Stone and Copper lead; the other four support.

| Token | Hex | Role |
| --- | --- | --- |
| `--poster` | #1a4a40 | Masthead, hero field |
| `--page` | #0c2823 | Page ground |
| `--panel96` | #12352e | Card surface (one tone step above the ground) |
| `--deep` | #071b17 | Inset rows, dark text on light fills |
| Blue Stone | #005B55 | Lead brand colour, Spin band, done states |
| Copper | #B37E2C | Lead accent: the season goal, primary actions, the hero frame |
| `--copper-hi` | lighter copper | Headline numbers, icons on dark |
| Deep Sky Blue | #00B1EA | Endurance, Ride band, Eddington ring, info chips |
| Amethyst | #9557A9 | Tempo, Long band, Trips tab |
| International Orange | #F4462F | Threshold and VO2, Eddington-day band, warnings |
| Cerise | #EA2C78 | Century band, heart rate |
| `--cream` | #f6eedb | Text on the poster green |

Distance bands (ride calendar and charts): Spin < 15 mi, Ride 15–30, Long 30–45, Big 45–55, Eddington 55–100, Century 100+, in `--band-1` to `--band-6`.

Rules:
- Colour carries meaning (distance band, intensity, good or bad). Deltas are coloured by good or bad, never by up or down; a zero change is grey.
- Status chips are a pale tint of the hue with text of the same hue, never white text on a saturated fill.
- Gold, silver and bronze are kept for 1st, 2nd and 3rd PR medals.

## 3. Typography

- Display: Saira Condensed (fallback Arial Narrow), weight 800, uppercase, for card titles, page titles and big numbers.
- Text: the system sans at 13–15px for sentences.
- Figures: tabular numerals wherever numbers line up. Monospace only for plan targets and table figures.
- Size floor: 11px for any label or chip, 12px for sentences. The headline figure (season distance) is the largest number on a screen.
- No serif italic: with green and gold it read as "the Masters" to Will.

## 4. Components

- **Card:** `--panel96` surface, a 4px left stripe in the card's tone, a faint gold hairline, and one Olympic pictogram before the uppercase title. One card per subject; no nested cards.
- **Rings:** the season goal is the big ring in the hero. The six small rings sit in one row: month, week vs needed per week, Eddington out of 55, 55-mile days, longest climb vs the Colombier. Rings draw in once on first load.
- **Tabs:** Today, Plan, Rides, Segments, Trips. Each tab has its own colour (copper, stone, sky, orange, amethyst), shown by a pill that slides between tabs.
- **Plan rows:** day, session, details (clamped), target miles, intensity colour, weather chip.
- **Chips:** small rounded pills inside rows only, never above a heading.
- **Buttons:** copper fill for the one primary action; outlined for the rest.

## 5. Layout

- Phone first: 16px gutters, one column, touch targets of 44px or more, nothing scrolls sideways. Wide tables stack into two-line rows.
- Desktop (64rem and up, mouse, not the installed app): two columns on Today, Plan and Trips; the hero, weather, distance and calendar span both.
- The two charts Will checks most (Distance and the ride calendar) live on Today.

## 6. Depth and elevation

- Surfaces separate by a step in tone. Cards have one soft shadow; menus, sheets and the plan editor float.
- One layered-peaks silhouette sits behind the rings (and the Trips header on desktop). It is a single image, never a repeating background.

## 7. Motion

- Phone: numbers count up once, rings draw in once, cards ease in as they scroll into view, the tab pill slides, a thin bar under the tabs shows scroll position.
- Desktop adds Lenis smooth scrolling, a soft spotlight and tilt on cards, magnetic masthead buttons, page titles that type in, chart lines that draw in, and a trail around Next up.
- One authored moment per screen is the aim; don't add a new effect without removing a weaker one.
- Everything is off under reduced motion. Nothing loops on the phone.

## 8. Do and don't

Do:
- Keep it dark green with Blue Stone and Copper leading.
- Use the six palette colours with a meaning attached.
- Use solid Olympic-style pictograms, a different one per card.
- Show the real numbers: Strava data, the plan, the weather.

Don't:
- No background patterns or checkerboards (the day-by-day ride calendar is fine).
- No laurels or leaves, no "Atlanta" or "'96" labels.
- No serif italic with green and gold.
- No gradient text, no glass or backdrop blur, no glows on the phone.
- No speed-trend, time-of-day or weekday charts (analysis paralysis).
- No charts with more hues than meanings.

## 9. Responsive behaviour

| Width | Layout |
| --- | --- |
| under 30rem | Tight tabs, sync button shows its icon only, rings shrink |
| under 40rem | One column; Last 4 weeks becomes a 2 × 2 grid; tables stack |
| 64rem and up with a mouse | Desktop extras switch on |
| 72rem and up | Two-column Today, Plan and Trips |

## 10. Agent prompt guide

- Theme source: `design/theme.tmpl.css`, built into `olympic96.css` by `python3 design/gen.py`; per-card icons and colours are in `design/icons.py`. Edit the template, then regenerate. Never hand-edit `olympic96.css`.
- Motion lives in `js/motion.js`; the desktop check is the `desk` class on `<html>`.
- Bump `CACHE` in `sw.js` on every release.
- Test at 360px and 412px (no sideways scroll) and at 1440px.
- Hub upgrade ideas go in the Claude Doc "Training Hub enhancement plan", not on the site.
