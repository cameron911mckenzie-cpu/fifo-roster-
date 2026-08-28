# SWING · FIFO Roster Planner

A dark, mining-themed calendar that tells you where you are supposed to be — **onsite** or **home on R&R** — for any month, any year, forever.

Pick a roster pattern, set the date of your first fly-in, choose how often you get paid, and the whole calendar fills itself in on a continuous cycle. Fly-in and fly-out days are marked on the first and last day of every swing, pay days get their own marker, and you can step month by month (or see three months or a full year at once).

It is a static site: no build step, no framework, no account, no server. Everything is computed in the browser from two dates.

## What it does

**Roster patterns**

- Twelve presets: `2/2`, `4/3`, `5/2`, `7/7`, `8/6`, `9/5`, `10/4`, `14/7`, `14/14`, `21/7`, `28/28`, plus fully custom *N on / M off*
- The cycle anchor is **day 1 of a swing** — set it once and the pattern repeats in both directions, so last year and 2031 are both correct
- Shift type: **Days**, **Nights**, or **Rotating** (day swings and night swings alternate)
- Fly-in marks the first day of every swing, fly-out marks the last day. Fly-out can count as a full day onsite or as travel home / the first day of your break — both are common in real rosters

**Pay day**

- Weekly, fortnightly, every 4 weeks, monthly on the same date, monthly on the last day, twice monthly (1st & 15th), or every N days
- Pay days are marked on the grid and counted in the swing table
- Optional pay-per-cycle amount, which then shows in the header countdown

**Calendar**

- **Month** view with status, day-of-swing, shift, fly markers, pay markers and notes on every cell
- **3-month** view for planning leave and trips
- **Year** view: twelve months at a glance with an onsite/home count per month — click any month to drill in
- Header countdowns: today's status, next fly-in, next R&R, next pay day
- Per-period stats: days onsite, days home, home share, swings, travel days, pay days
- Swing table underneath: every swing touching the view, with fly-in, fly-out, shift, R&R length and pay days inside it

**Day details**

- Click any day for the full picture: swing number, day N of M, cycle position, fly-in/fly-out dates, when you are back onsite, and whether it is a pay day
- Per-day notes (flight numbers, medico, camp, handover) saved in the browser and shown on the grid

**Sharing and export**

- Copy a **share link** — the whole roster is encoded in the URL, and the address bar always reflects your current setup
- **Export .ics** — 12 months of swings, fly-in/fly-out reminders and pay days as all-day calendar events, ready for Google Calendar, Outlook or Apple Calendar
- **Print** — the print stylesheet drops the controls and prints the calendar light-on-dark-free for the fridge or the crib room

**Practical touches**

- Monday or Sunday week start
- Keyboard shortcuts: `←` `→` move, `T` today, `M` / `3` / `Y` switch view, `Esc` close
- Saved automatically to this browser's local storage; nothing is uploaded anywhere
- Works on a phone: settings collapse into a slide-out panel and the grid stays readable

## How the roster maths works

```
cycle length  = days onsite + days home
cycle index   = (days since anchor) mod cycle length
onsite        = cycle index < days onsite
fly-in        = cycle index 0                 (first day of the swing)
fly-out       = cycle index days onsite - 1   (last day of the swing)
```

Day counting is done on local calendar dates rather than UTC timestamps, so a daylight-saving change can never shift your swing by a day — which matters in Australian mining towns on Queensland time.

All of this lives in `roster.js` as pure functions with no DOM access, and is covered by unit tests (see below).

## Run it

It is a static site. From this directory:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>. No API key, no account, no install. An internet connection is only used to load the Inter and Oswald webfonts — the app falls back to system fonts if they are unavailable.

## Tests

The roster maths is unit tested with node's built-in test runner — no dependencies to install:

```bash
node --test
```

21 tests cover swing boundaries for each pattern, backwards cycles before the anchor date, daylight-saving-safe day counting, leap years and short months for monthly pay, custom pay intervals, shift rotation, travel-day handling and input coercion.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup and the inline SVG icon set |
| `styles.css` | Theme, calendar layout, responsive rules, print stylesheet |
| `roster.js` | Pure roster, pay and statistics maths (no DOM) |
| `app.js` | State, rendering, calendar views, drawer, ICS export, share links |
| `tests/roster.test.js` | Unit tests for `roster.js` |

## Next build steps

- Overtime / hours tracking per swing, with an estimate of gross pay per cycle
- Leave and RDO overlay so annual leave can be dropped onto the calendar
- Crew shift times (start/end, night handover) instead of just day/night
- Sync a roster with a partner's or mate's calendar to find overlapping home days
- .ics subscription URL so exported rosters stay updated
- Offline support via a service worker

> Planning aid only. Always confirm swing dates, travel bookings and pay dates against your official roster and pay advice.
