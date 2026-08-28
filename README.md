# Gold Scout

A dark, field-first prospecting map prototype for Queensland. Gold Scout brings official Queensland map services and a transparent shortlist model into one place, so a prospector can compare imagery, tenure, structure and known mineral occurrences before committing to a drive.

## What is in the prototype

- Queensland latest imagery, topo and OpenStreetMap basemaps
- Live WMS overlays for granted mining leases, granted mineral exploration permits, detailed faults / shear zones, mineral occurrences, state geology and a Queensland magnetic response image
- A beta **Prospecting signal** layer with three modelled target zones around the selected goldfield
- Adjustable model weights for structure, drainage / low-slope setting and known gold evidence
- Town / goldfield search, browser geolocation, coordinate readout, map share link, fullscreen, target inspection and local saved targets
- Source notes and a prominent access / tenure safety reminder

The modelled signal is intentionally presented as a planning aid, not a “magic scan”, geological prediction, or guarantee of gold. The live map layers are context only. Users must verify current authority information, access permissions, fossicking rules, protected / restricted areas and cultural restrictions before entering ground. GeoResGlobe is linked from the app for that check.

## Data sources

The app links directly to public Queensland Government services in the browser:

- Queensland latest satellite imagery and topographic basemap services
- Queensland current mines and permits service (the service notes nightly updates)
- Queensland detailed geology and state geology services
- Queensland mineral resources / mineral occurrence service
- OpenStreetMap for the street basemap

Services can change or be unavailable. The interface continues to load with a map fallback and source notes if the live tiles cannot be reached.

## Run locally

It is a static site. From this directory:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>. An internet connection is needed for Leaflet and the live map tiles / overlays. No API key or account is required by this prototype.

## Next build steps

- Add official feature querying and click-through permit details
- Add an AOI draw / buffer tool and downloadable field pack
- Add authenticated notes, photos and offline cached tiles
- Add more transparent geoscience inputs such as airborne magnetics, radiometrics, regolith and DEM-derived drainage
- Validate the scoring model with a geologist and field users before using it beyond a prototype
