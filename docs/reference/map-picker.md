[Manual](../README.md) › [Map tile picker](../MAP-PICKER.md) › Reference

# Map tile picker reference

Clicks always snap to the nearest walkable tile. The basemap is never used for pathing.

## Display modes

`Pick on Map` on a `type: 'tile'` script setting opens a modal with two modes.

| Show basemap | What you see |
|---|---|
| On (default) | Classic [2004scape worldmap](https://2004.lostcity.rs/worldmap) surface terrain, plus optional Key / multi / free / labels |
| Off | Collision-dot grid and named destination markers |

`worldmap.jag` has no L1–L3 floor rasters, so an upper Level falls back to collision
dots on that plane rather than rendering nothing.

Default basemap view is terrain only, with no Key types selected.

## Baked assets

| Asset | Role |
|---|---|
| `worldmap-basemap.<fp>.png` | Terrain only, no Key icons |
| `worldmap-key-type-<id>.<fp>.png` | One transparent overlay per Key legend type |
| `worldmap-key.<fp>.png` | All Key icons, composite; fallback |
| `worldmap-labels.<fp>.png` | Town and place names, transparent |
| `worldmap-key-index.<fp>.json` | Names and placements |
| `worldmap-multi.<fp>.png`, `worldmap-free.<fp>.png` | Zone tints |
| `worldmap-basemap.manifest.json` | URLs and geometry |

Key names match the classic applet Key panel (`WORLDMAP_KEY_NAMES`). Each type is
pre-generated as its own overlay, so Settings can toggle Bank without Altar at no
MapView cost.

## Settings

| Key | Default | Group | Purpose |
|---|---|---|---|
| `showBasemap` | `true` | Display | Worldmap vs classic dots and destinations |
| `dotColor`, `dotAlpha` | dark blue | Display | Dot style; classic mode only |
| `keyIconTypes` | `[]` | Worldmap layers | Multiselect of Key legend types |
| `showPlaceLabels` | `false` | Worldmap layers | Town and place names |
| `showMultiTint`, `showFreeTint` | `false` | Worldmap layers | Zone tints |
| `bakeLabels` … | `false` | Basemap rebuild | Rare live MapView stamps |
| `skipRebuildConfirm` | `false` | Basemap rebuild | Skip the freeze warning |

## See also

- [Bake the basemap](../how-to/bake-the-basemap.md)
