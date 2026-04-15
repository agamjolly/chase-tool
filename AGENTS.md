# AGENTS.md

Technical reference for AI agents and contributors working on The Edit Atlas.

## Stack

- **Vite** — dev server and production bundler
- **Vanilla JS** — no framework; single-file app in `src/main.js` (~1,080 lines)
- **CSS** — single-file styles in `src/style.css` (~1,320 lines)
- **MapLibre GL** — interactive map with raster tiles (CartoDB Voyager)
- **Supercluster** — client-side marker clustering for the map view
- **Google Fonts** — Instrument Serif (headings) + Space Grotesk (body/UI)

No build-time CSS processing. No state management library. No component framework.

## File Map

| File | Purpose |
|------|---------|
| `src/main.js` | All application logic: HTML template, state, rendering, events |
| `src/style.css` | All styles: layout, components, map, animations, responsive |
| `index.html` | Minimal shell — loads fonts, mounts `#app` |
| `public/data/properties.json` | Shipping dataset: 1,370 hotels, 23 fields each |
| `scripts_build_properties.js` | Builds `properties.json` from source data files |
| `scripts_extract_public_edit.js` | Extracts public Chase editorial cross-check data |
| `data/replit-hotels.json` | Source: mirrored dataset from third-party Replit app |
| `data/public-edit-properties.json` | Source: public Chase editorial cross-check |
| `data/properties-analysis.json` | Generated validation counts |
| `SOURCES.md` | Data provenance documentation |

## Architecture

### State

All application state lives in a single `state` object:

```
state.items            — full hotel array (loaded once from properties.json)
state.filtered         — current filtered subset (recomputed on every sync)
state.collections      — Set of active collection keys: 'the-edit', 'select-credit', 'editorial'
state.search           — applied search string (set on Enter/suggestion click)
state.draftSearch      — live typed value in search input (not applied until committed)
state.viewMode         — 'list' or 'map'
state.visibleCountries — pagination counter for country groups in list view
state.filtersExpanded  — boolean, whether the Refine panel is open
state.filters          — object containing:
  .starRatings         — Set of selected thresholds: 5, 4.5, 4, 3.5
  .priceRange          — [min, max] tuple, default [335, 1250]
  .partnerBrands       — array of selected brand strings (OR logic)
  .chaseConfirmed      — boolean toggle
  .tripAdvisorMin      — null (any) or numeric threshold
```

### Rendering Pipeline

There is no virtual DOM or diff engine. The app uses direct DOM manipulation:

1. `sync()` — master update function. Recomputes `state.filtered`, rebuilds the country list, updates autocomplete, rebuilds map clusters. Accepts `{ animate }` option to control fade transitions.
2. `renderCountryList()` — rebuilds the list view HTML via `innerHTML` on the country list container. Wires click handlers on each card.
3. `renderViewMode()` — toggles visibility between list and map sections with crossfade transitions. On map activation, calls `ensureMap()` then `updateMap()`.
4. `updateMap()` — clears all markers, rebuilds cluster data from `state.filtered`, resizes the map, fits bounds, re-renders markers.
5. `renderFilterDrawer()` — rebuilds the filter panel HTML and wires all pill/checkbox/slider handlers. Called on every filter state change and on panel open/close.
6. `renderAutocomplete()` — rebuilds autocomplete dropdown from `state.suggestions`.

### Filter System

Filters live in a floating dropdown panel toggled by the "Refine" button. The panel uses **staged application**: clicking pills/checkboxes updates state but does NOT trigger `sync()`. The user clicks "Apply" to commit, which closes the panel and calls `sync()`. "Clear all" resets to defaults and syncs immediately.

Filter logic in `matchesFilters()`:
- All filter categories combine with AND logic
- Within categories that support multi-select (collections, star ratings), items pass if they match ANY selected option (OR logic)
- Collections: 'the-edit' matches all items, 'select-credit' matches items with a `partnerGroup`, 'editorial' matches items with `publiclyConfirmedByChase`
- Star ratings: each threshold matches a range (e.g. 4.5 matches 4.5 <= rating < 5)
- Price range: items with a `priceValue` outside the range are excluded; items without a price pass through
- Partner brands: OR logic across selected brands
- Tripadvisor: minimum threshold filter

Active filter count is shown as a badge on the Refine button. Count logic is in `activeFilterCount()`.

### Search

Search uses a two-phase model:

1. **Draft phase** — typing updates `state.draftSearch` and rebuilds autocomplete suggestions. No filtering happens.
2. **Apply phase** — pressing Enter, clicking the search button, selecting a suggestion, or clicking the back arrow calls `applySearch()`, which sets `state.search` and triggers `sync()`.

Autocomplete suggestions are built by `buildSuggestions()` which ranks matches across countries, cities, hotel names, and partner groups. Ranking uses `rankMatch()`: exact match > starts-with > word-boundary > substring.

Clearing the search (native × button on `type="search"` input, or the back arrow button) calls `applySearch('')` to reset.

### Map

The map initializes lazily on first switch to map view via `ensureMap()`.

**Tiles**: CartoDB Voyager raster tiles (`a.basemaps.cartocdn.com/rastertiles/voyager`).

**Clustering**: Supercluster processes the filtered dataset. `buildClusterData()` loads features into the cluster engine. `renderMarkers()` queries visible clusters for the current viewport bounds and zoom, creates/reuses DOM marker elements, and manages the `markerCache` and `markersOnScreen` Maps for efficient add/remove.

**Marker types**:
- Hotel markers: price pill showing the preview price. Blue (`--accent`) for Edit hotels, green (`--forest`) for partner group hotels.
- Cluster markers: frosted glass pill showing property count.

**Interactions**:
- Cluster click: zooms to the cluster's expansion zoom level
- Hotel marker hover/focus: shows a popup card with image, name, location, price, and star rating
- Hotel marker click: opens Google search for that hotel

**Performance**: Marker updates are debounced via `requestAnimationFrame` on the `moveend` event. CRITICAL: never add CSS `transition` on `transform` to marker elements — MapLibre uses `transform` for marker positioning during zoom/pan, and transitioning it causes severe lag.

### Transitions

View changes and content updates use CSS opacity transitions (260ms):

- `FADE_MS` constant controls duration
- `fadeOut()` / `fadeIn()` add/remove `.is-fading` class
- `sync()` fades the active view out, updates DOM, fades back in
- `renderViewMode()` crossfades between list and map sections
- "Load More" uses a slide-up entrance (`.is-entering` class with `translateY` + opacity) instead of a full fade
- First render (`firstRender` flag) skips all animation

### Background Animation

The page background uses a CSS `@keyframes paper-light` animation on `body::before` (fixed, full viewport, `z-index: 0`). It cycles between warm cream (`#faf8f4`) and pale sapphire (`#eaeff6`) over 30 seconds. The `.page-shell` sits above it at `z-index: 1`. The topbar is transparent by default so the animated color shows through.

## CSS Architecture

### Design Tokens (CSS Variables)

```
--paper: #f5efe4         — warm paper background
--paper-deep: #ece1cf    — deeper warm tone
--panel: rgba(…, 0.8)    — frosted glass panels
--panel-strong: rgba(…, 0.94) — opaque panels (search input)
--line: rgba(…, 0.1)     — subtle borders
--ink: #3a3a38           — warm charcoal, primary text
--muted: #61718b         — secondary text
--accent: #3a3a38        — warm charcoal, interactive elements
--forest: #1a6a55        — green, $250 partner indicators
--shadow: 0 24px 48px …  — standard elevation
```

### Typography

- Headings (brand, section titles, country names): `Instrument Serif`, weight 400, tight letter-spacing (-0.03em)
- Body and UI: `Space Grotesk`, weights 400/500/700
- Map pills, price badges, filter pills, cluster labels: `Space Grotesk` 500, 0.74rem, letter-spacing 0.01em

### Key Component Patterns

- **Frosted glass**: `background: rgba(255,255,255,0.55)` + `backdrop-filter: blur(12-16px)` + white translucent border. Used on: cluster pills, map legend, hover popup, topbar (on scroll), price badges.
- **Pills**: `border-radius: 999px`. Filter pills use outlined default / filled active states. Map pills use solid backgrounds.
- **Half-star rendering**: `.half-star` uses `position: relative` with a `::before` pseudo-element at `width: 50%` + `overflow: hidden` to clip the star glyph in half. Same pattern for `.half-dot` (Tripadvisor dots).
- **Cards**: `border-radius: 1.25rem`, subtle shadow (`0 2px 12px`), hover lifts `translateY(-3px)`. Image uses `aspect-ratio: 1.55/1` with `flex-shrink: 0`. Body uses flex column with `justify-content: center`.

### Responsive Breakpoints

- `@media (max-width: 900px)` — stacks topbar, adjusts map height, smaller headings
- `@media (max-width: 640px)` — single-column cards, smaller font sizes, tighter padding

## Data Model

Each hotel in `properties.json` has these fields:

```
id, name, location, city, country, lat, lng,
starRating, tripAdvisorRating, priceLabel, priceValue,
image, partnerGroup, publiclyConfirmedByChase, collection,
brandWebsite, tripAdvisorUrl, bookingUrl, chaseUrl,
tags, description, roomCount, yearOpened
```

Key fields for filtering:
- `partnerGroup` — string name of the $250 partner group, or null
- `publiclyConfirmedByChase` — boolean
- `starRating` — numeric (3.5–5)
- `priceValue` — numeric preview price in USD, or null
- `tripAdvisorRating` — numeric (1–5), or null

## Critical Gotchas

1. **No CSS `transition: transform` on map markers.** MapLibre uses `transform` to reposition markers during zoom/pan. A CSS transition on that property makes every marker animate its repositioning instead of snapping, causing massive lag across all markers.

2. **`state.search` vs `state.draftSearch` must stay separate.** `draftSearch` is the live input value; `search` is the committed filter. Merging them causes instant filtering on every keystroke which is jarring with 1,370 items.

3. **`renderFilterDrawer()` rebuilds the entire panel DOM.** Don't call it from within pill click handlers for staged filters (star, collection, brand) or it will destroy the panel and lose focus. Only call it for TA pills (which need visual state across all pills) and on Apply/Clear.

4. **Price text inputs use `change` event, not `input`.** The `input` event fires on every keystroke and the clamping logic (min 335, max 1250) would snap partial values (e.g. typing "5" snaps to "335"). Sliders use `input` for live feedback since they're already constrained.

5. **`sync()` accepts `{ animate }` option.** Initial data load passes `{ animate: false }` to avoid a fade-in on first render. All user-triggered syncs use the default `animate: true`.

6. **`firstRender` flag in `renderViewMode()`.** Prevents the crossfade animation on the initial view setup. Without this, the page would fade in from invisible on load.

7. **`stopPropagation` on the filter panel.** The document-level click handler closes the panel when clicking outside `.refine-wrapper`. The panel itself calls `stopPropagation` to prevent internal clicks from bubbling up and triggering this close.

8. **ResizeObserver on topbar.** Content top padding is dynamically synced to the topbar's actual height via a `ResizeObserver`, not a hardcoded value. This handles filter panel open/close and responsive layout changes.

## Local Commands

```bash
npm install          # install dependencies
npm run dev          # start Vite dev server
npm run build        # production build to dist/
npm run preview      # preview production build

# Rebuild dataset from source files:
node scripts_extract_public_edit.js
node scripts_build_properties.js
```

## Planned Work

- **Live pricing backend**: FastAPI server with MakCorps / Amadeus / SerpAPI fallback chain for multi-OTA hotel price comparison. See plan file for full spec.
- **Date picker**: Calendar popover for check-in/check-out dates to enable price lookups.
- **Price comparison on cards**: "Compare prices" button showing prices from multiple booking sites.
