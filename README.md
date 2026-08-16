# FIFO Roster Calendar ✈

A free rolling roster calendar for FIFO workers. Punch in your swing once and it rolls forever — marking fly-in / fly-out days, days on site (day & night shifts), days at home, and pay days.

**Live app:** https://cameron911mckenzie-cpu.github.io/fifo-roster-/

## Features
- **Any roster pattern** — presets for 7/7, 8/6, 14/14, 14/7, 21/7, 2wk/2wk, or fully custom days on / days off
- **Continuous rolling calendar** — browse any month, past or future; the roster is always correct
- **Day / night rotations** — days only, nights only, days→nights within a swing, nights→days, or alternating day/night swings
- **Fly days** — fly-in marked on day 1; fly-out on last shift day or the day after (your choice)
- **Pay days** — weekly, fortnightly, or monthly, projected forever from one known pay day
- **Print a month at a time** — clean A4 landscape printout, one month per page
- **Share your roster** — send family a link that opens your exact calendar
- **Share the app** — send mates a blank template link so they set up their own roster
- **Phone calendar export** — .ics file (next 12 months) for Google / Apple / Outlook calendars
- **Themes** — Sky, Coal, Gold, Underground Mining
- Settings save automatically in your browser. No account, no server, works offline once loaded.

## Run locally
It's a static site — just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8080
```

## Deploying
GitHub Pages serves the site straight from the `main` branch (Settings → Pages → Deploy from a branch → `main` / root).
