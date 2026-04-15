import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="page-shell">
    <header class="topbar" id="topbar">
      <div class="topbar__row topbar__row--main">
        <div class="topbar__brand">
          <h1>The Edit Atlas</h1>
        </div>

        <label class="search search--hero">
          <span class="sr-only">Search hotels</span>
          <input id="searchInput" type="search" placeholder="Search by property, city, country, or brand" />
          <div id="autocomplete" class="autocomplete autocomplete--hidden"></div>
        </label>

        <div class="view-switch" id="viewSwitch"></div>
      </div>

      <div class="topbar__row topbar__row--sub">
        <div class="topbar__filters">
          <span class="topbar__label">Filters</span>
          <div class="segmented segmented--top" id="offerFilters"></div>
        </div>
      </div>
    </header>

    <main class="content">
      <section id="listView" class="content-view">
        <header class="editorial-hero">
          <div class="editorial-hero__row">
            <div class="editorial-hero__copy">
              <h2>Browse The Edit by country</h2>
              <p>
                <span id="resultsCount">0</span> hotels arranged destination-first, with the map
                reserved for geographic scanning.
              </p>
            </div>
          </div>
        </header>
        <div id="countryList" class="country-list"></div>
      </section>

      <section id="mapView" class="content-view content-view--hidden">
        <div class="content-header content-header--map">
          <div>
            <p class="eyebrow">Map View</p>
            <h2>Nightly-price style map markers</h2>
          </div>
          <p class="content-header__note">
            Hotel cards open a Google search in a new tab. Marker prices are visual previews, not
            live Chase Travel quotes.
          </p>
        </div>
        <div class="map-frame">
          <div id="map"></div>
          <aside class="map-legend">
            <div>
              <span class="legend__swatch legend__swatch--edit"></span>
              <span>The Edit property</span>
            </div>
            <div>
              <span class="legend__swatch legend__swatch--partner"></span>
              <span>Official $250 partner overlap</span>
            </div>
            <p>Prices shown on the map are preview values.</p>
          </aside>
        </div>
      </section>
    </main>
  </div>
`;

const OFFER_FILTERS = [
  { key: 'all', label: 'All hotels' },
  { key: 'the-edit', label: 'The Edit' },
  { key: 'select-credit', label: '$250 credit groups' },
];

const VIEW_MODES = [
  { key: 'list', label: 'List' },
  { key: 'map', label: 'Map' },
];

const state = {
  items: [],
  filtered: [],
  offerFilter: 'all',
  search: '',
  draftSearch: '',
  viewMode: 'list',
  autocompleteOpen: false,
  activeSuggestionIndex: -1,
  suggestions: [],
};

const elements = {
  topbar: document.querySelector('#topbar'),
  viewSwitch: document.querySelector('#viewSwitch'),
  offerFilters: document.querySelector('#offerFilters'),
  searchInput: document.querySelector('#searchInput'),
  autocomplete: document.querySelector('#autocomplete'),
  resultsCount: document.querySelector('#resultsCount'),
  countryList: document.querySelector('#countryList'),
  listView: document.querySelector('#listView'),
  mapView: document.querySelector('#mapView'),
};

let map;
let hoverPopup;
let markerCache = new Map();
let markersOnScreen = new Map();
let clusterEngine = new Supercluster({
  radius: 52,
  maxZoom: 16,
  map: (props) => ({
    minPrice: props.priceValue ?? Number.POSITIVE_INFINITY,
  }),
  reduce: (accumulated, props) => {
    accumulated.minPrice = Math.min(accumulated.minPrice, props.minPrice);
  },
});

function formatCurrency(value) {
  if (!Number.isFinite(value)) return 'View';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function priceLabel(item) {
  if (Number.isFinite(item.priceValue)) return formatCurrency(item.priceValue);
  return item.priceLabel || 'View';
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function googleSearchUrl(item) {
  return `https://www.google.com/search?q=${encodeURIComponent(item.name)}`;
}

function openHotelSearch(item) {
  window.open(googleSearchUrl(item), '_blank', 'noopener,noreferrer');
}

function normalizeSearchValue(value) {
  return String(value || '').trim().toLowerCase();
}

function rankMatch(target, query) {
  const haystack = normalizeSearchValue(target);
  if (!haystack || !query) return null;
  if (haystack === query) return 0;
  if (haystack.startsWith(query)) return 1;
  const wordIndex = haystack.indexOf(` ${query}`);
  if (wordIndex >= 0) return 2;
  const includes = haystack.indexOf(query);
  if (includes >= 0) return 3;
  return null;
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSuggestions(query) {
  if (!query) return [];

  const hotels = uniqueBy(
    state.items
      .map((item) => ({ item, rank: rankMatch(item.name, query) }))
      .filter((entry) => entry.rank !== null)
      .sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name))
      .slice(0, 5)
      .map(({ item }) => ({
        type: 'hotel',
        value: item.name,
        title: item.name,
        subtitle: item.location || [item.city, item.country].filter(Boolean).join(', '),
      })),
    (item) => `${item.type}:${item.value}`,
  );

  const cities = uniqueBy(
    state.items
      .filter((item) => item.city)
      .map((item) => ({
        city: item.city,
        country: item.country,
        rank: rankMatch(item.city, query),
      }))
      .filter((entry) => entry.rank !== null)
      .sort((a, b) => a.rank - b.rank || a.city.localeCompare(b.city))
      .slice(0, 3)
      .map((entry) => ({
        type: 'city',
        value: entry.city,
        title: entry.city,
        subtitle: entry.country || 'City',
      })),
    (item) => `${item.type}:${item.value}`,
  );

  const countries = uniqueBy(
    state.items
      .filter((item) => item.country)
      .map((item) => ({
        country: item.country,
        rank: rankMatch(item.country, query),
      }))
      .filter((entry) => entry.rank !== null)
      .sort((a, b) => a.rank - b.rank || a.country.localeCompare(b.country))
      .slice(0, 3)
      .map((entry) => ({
        type: 'country',
        value: entry.country,
        title: entry.country,
        subtitle: 'Country',
      })),
    (item) => `${item.type}:${item.value}`,
  );

  const groups = uniqueBy(
    state.items
      .filter((item) => item.partnerGroup)
      .map((item) => ({
        group: item.partnerGroup,
        rank: rankMatch(item.partnerGroup, query),
      }))
      .filter((entry) => entry.rank !== null)
      .sort((a, b) => a.rank - b.rank || a.group.localeCompare(b.group))
      .slice(0, 2)
      .map((entry) => ({
        type: 'partner',
        value: entry.group,
        title: entry.group,
        subtitle: '$250 partner group',
      })),
    (item) => `${item.type}:${item.value}`,
  );

  return [...hotels, ...cities, ...countries, ...groups].slice(0, 8);
}

function closeAutocomplete() {
  state.autocompleteOpen = false;
  state.activeSuggestionIndex = -1;
  renderAutocomplete();
}

function applySearch(value) {
  state.search = String(value || '').trim();
  state.draftSearch = state.search;
  elements.searchInput.value = state.draftSearch;
  state.suggestions = buildSuggestions(normalizeSearchValue(state.draftSearch));
  closeAutocomplete();
  sync();
}

function applySuggestion(suggestion) {
  applySearch(suggestion.value);
}

function renderAutocomplete() {
  const shouldShow =
    state.autocompleteOpen && state.suggestions.length > 0 && normalizeSearchValue(state.draftSearch);

  elements.autocomplete.classList.toggle('autocomplete--hidden', !shouldShow);
  if (!shouldShow) {
    elements.autocomplete.innerHTML = '';
    return;
  }

  elements.autocomplete.innerHTML = state.suggestions
    .map(
      (suggestion, index) => `
        <button
          class="autocomplete__item ${index === state.activeSuggestionIndex ? 'is-active' : ''}"
          type="button"
          data-index="${index}"
        >
          <span class="autocomplete__type">${escapeHtml(suggestion.type)}</span>
          <span class="autocomplete__text">
            <strong>${escapeHtml(suggestion.title)}</strong>
            <small>${escapeHtml(suggestion.subtitle || '')}</small>
          </span>
        </button>
      `,
    )
    .join('');

  elements.autocomplete.querySelectorAll('.autocomplete__item').forEach((button) => {
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const suggestion = state.suggestions[Number(button.dataset.index)];
      if (suggestion) applySuggestion(suggestion);
    });
  });
}

function renderViewSwitch() {
  elements.viewSwitch.innerHTML = VIEW_MODES.map(
    (view) => `
      <button class="segmented__button ${state.viewMode === view.key ? 'is-active' : ''}" data-view="${view.key}">
        ${view.label}
      </button>
    `,
  ).join('');

  elements.viewSwitch.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      state.viewMode = button.dataset.view;
      renderViewMode();
    });
  });
}

function renderOfferFilters() {
  elements.offerFilters.innerHTML = OFFER_FILTERS.map(
    (filter) => `
      <button class="segmented__button ${filter.key === state.offerFilter ? 'is-active' : ''}" data-filter="${filter.key}">
        ${filter.label}
      </button>
    `,
  ).join('');

  elements.offerFilters.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      state.offerFilter = button.dataset.filter;
      sync();
    });
  });
}

function matchesFilters(item) {
  const haystack = [
    item.name,
    item.location,
    item.city,
    item.country,
    item.partnerGroup,
    item.collection,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (state.search && !haystack.includes(state.search.toLowerCase())) return false;
  if (state.offerFilter === 'select-credit' && !item.partnerGroup) return false;
  return true;
}

function propertyCardMarkup(item) {
  const tags = [
    item.publiclyConfirmedByChase ? 'Featured by Chase' : null,
    item.partnerGroup ? 'Official $250 partner brand' : null,
  ].filter(Boolean);

  return `
    <button class="property-card" data-id="${item.id}">
      <div class="property-card__media">
        ${
          item.image
            ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" />`
            : '<div class="property-card__media-fallback"></div>'
        }
        <span class="property-card__price">${escapeHtml(priceLabel(item))}</span>
      </div>
      <div class="property-card__body">
        <p class="property-card__eyebrow">${escapeHtml(item.partnerGroup ? 'The Edit · Partner Group' : 'The Edit')}</p>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.location || [item.city, item.country].filter(Boolean).join(', '))}</p>
      </div>
      <div class="property-card__tags">
        ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}
      </div>
    </button>
  `;
}

function renderCountryList() {
  elements.resultsCount.textContent = String(state.filtered.length);

  const groups = state.filtered.reduce((accumulator, item) => {
    const key = item.country || 'Other';
    if (!accumulator.has(key)) accumulator.set(key, []);
    accumulator.get(key).push(item);
    return accumulator;
  }, new Map());

  const countries = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  elements.countryList.innerHTML = countries.length
    ? countries
        .map((country) => {
          const items = groups.get(country).sort((a, b) => a.name.localeCompare(b.name));
          return `
            <section class="country-group">
              <div class="country-group__header">
                <h3>${escapeHtml(country)}</h3>
                <span>${items.length} hotel${items.length === 1 ? '' : 's'}</span>
              </div>
              <div class="country-group__grid">
                ${items.map(propertyCardMarkup).join('')}
              </div>
            </section>
          `;
        })
        .join('')
    : `<div class="empty-state">No hotels match your current filters.</div>`;

  elements.countryList.querySelectorAll('.property-card').forEach((card) => {
    card.addEventListener('click', () => {
      const item = state.filtered.find((entry) => entry.id === card.dataset.id);
      if (item) openHotelSearch(item);
    });
  });
}

function popupMarkup(item) {
  const tags = [
    item.partnerGroup,
    item.publiclyConfirmedByChase ? 'Chase confirmed' : 'Mirror dataset',
    item.starRating ? `${item.starRating}-star` : null,
  ].filter(Boolean);

  return `
    <article class="map-hover-card">
      ${
        item.image
          ? `<img class="map-hover-card__image" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" />`
          : ''
      }
      <div class="map-hover-card__body">
        <p class="map-hover-card__eyebrow">${escapeHtml(item.collection || 'The Edit by Chase Travel')}</p>
        <h3>${escapeHtml(item.name)}</h3>
        <p class="map-hover-card__location">${escapeHtml(
          item.location || [item.city, item.country].filter(Boolean).join(', '),
        )}</p>
        <div class="map-hover-card__meta">
          <span>${escapeHtml(priceLabel(item))} nightly</span>
          ${
            item.tripAdvisorRating
              ? `<span>Tripadvisor ${escapeHtml(item.tripAdvisorRating)}/5</span>`
              : ''
          }
          ${
            item.tripAdvisorCount
              ? `<span>${escapeHtml(item.tripAdvisorCount)} reviews</span>`
              : ''
          }
        </div>
        ${
          tags.length
            ? `<div class="map-hover-card__tags">${tags
                .map((tag) => `<span>${escapeHtml(tag)}</span>`)
                .join('')}</div>`
            : ''
        }
      </div>
    </article>
  `;
}

function ensureMap() {
  if (map) return;

  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'osm',
          type: 'raster',
          source: 'osm',
        },
      ],
    },
    center: [5, 18],
    zoom: 1.35,
    minZoom: 1,
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.on('load', () => {
    fitMapToItems();
    renderMarkers();
  });
  map.on('idle', renderMarkers);
  map.on('moveend', renderMarkers);
  map.on('zoomend', renderMarkers);
}

function showHoverPopup(item, lngLat) {
  if (!map) return;
  if (!hoverPopup) {
    hoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 18,
      className: 'hotel-hover-popup',
      maxWidth: '360px',
    });
  }

  hoverPopup.setLngLat(lngLat).setHTML(popupMarkup(item)).addTo(map);
}

function hideHoverPopup() {
  if (hoverPopup) hoverPopup.remove();
}

function buildClusterData(items) {
  clusterEngine.load(
    items
      .filter((item) => Number.isFinite(item.lng) && Number.isFinite(item.lat))
      .map((item) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [item.lng, item.lat],
        },
        properties: {
          id: item.id,
          isPartner: Boolean(item.partnerGroup),
          priceValue: item.priceValue,
          priceLabel: priceLabel(item),
        },
      })),
  );
}

function createMarkerElement({ label, tone, cluster }) {
  const button = document.createElement('button');
  button.className = `price-pill ${tone ? `price-pill--${tone}` : ''} ${cluster ? 'price-pill--cluster' : ''}`;
  button.type = 'button';
  button.textContent = label;
  return button;
}

function renderMarkers() {
  if (!map) return;
  const bounds = map.getBounds();
  if (!bounds) return;

  const clusters = clusterEngine.getClusters(
    [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
    Math.round(map.getZoom()),
  );
  const nextMarkers = new Map();

  for (const feature of clusters) {
    const [lng, lat] = feature.geometry.coordinates;
    const props = feature.properties;
    const markerId = props.cluster ? `cluster-${props.cluster_id}` : `hotel-${props.id}`;

    let marker = markerCache.get(markerId);
    if (!marker) {
      const isCluster = Boolean(props.cluster);
      const label = isCluster ? `${props.point_count} properties` : props.priceLabel;
      const tone = isCluster ? 'cluster' : props.isPartner ? 'partner' : 'edit';
      const element = createMarkerElement({ label, tone, cluster: isCluster });

      if (isCluster) {
        element.addEventListener('click', () => {
          const zoom = clusterEngine.getClusterExpansionZoom(props.cluster_id);
          map.easeTo({ center: [lng, lat], zoom: Math.max(zoom, map.getZoom() + 1) });
        });
      } else {
        element.addEventListener('mouseenter', () => {
          const item = state.filtered.find((entry) => entry.id === props.id);
          if (item) showHoverPopup(item, [lng, lat]);
        });
        element.addEventListener('mouseleave', hideHoverPopup);
        element.addEventListener('focus', () => {
          const item = state.filtered.find((entry) => entry.id === props.id);
          if (item) showHoverPopup(item, [lng, lat]);
        });
        element.addEventListener('blur', hideHoverPopup);
        element.addEventListener('click', () => {
          const item = state.filtered.find((entry) => entry.id === props.id);
          if (item) openHotelSearch(item);
        });
      }

      marker = new maplibregl.Marker({ element, anchor: 'center' }).setLngLat([lng, lat]);
      markerCache.set(markerId, marker);
    }

    nextMarkers.set(markerId, marker);
    if (!markersOnScreen.has(markerId)) marker.addTo(map);
  }

  for (const [id, marker] of markersOnScreen) {
    if (!nextMarkers.has(id)) marker.remove();
  }

  markersOnScreen = nextMarkers;
}

function fitMapToItems() {
  if (!map || !state.filtered.length) return;

  const points = state.filtered.filter((item) => Number.isFinite(item.lng) && Number.isFinite(item.lat));
  if (!points.length) return;

  const bounds = new maplibregl.LngLatBounds();
  points.forEach((item) => bounds.extend([item.lng, item.lat]));
  map.fitBounds(bounds, { padding: 64, maxZoom: 4.1, duration: 0 });
}

function renderViewMode() {
  renderViewSwitch();
  const isMap = state.viewMode === 'map';

  elements.listView.classList.toggle('content-view--hidden', isMap);
  elements.mapView.classList.toggle('content-view--hidden', !isMap);
  window.scrollTo(0, 0);

  if (isMap) {
    ensureMap();
    requestAnimationFrame(() => {
      map.resize();
      fitMapToItems();
      renderMarkers();
    });
  } else {
    hideHoverPopup();
  }
}

function sync() {
  renderOfferFilters();
  state.filtered = state.items.filter(matchesFilters);
  state.suggestions = buildSuggestions(normalizeSearchValue(state.draftSearch));
  renderAutocomplete();
  renderCountryList();
  hideHoverPopup();
  buildClusterData(state.filtered);

  if (state.viewMode === 'map') {
    renderViewMode();
  }
}

async function loadData() {
  const response = await fetch('/data/properties.json');
  if (!response.ok) {
    throw new Error(`Unable to load properties.json (${response.status})`);
  }

  const payload = await response.json();
  state.items = payload.properties;
  sync();
  renderViewMode();
}

elements.searchInput.addEventListener('input', (event) => {
  state.draftSearch = event.target.value.trim();
  state.autocompleteOpen = true;
  state.activeSuggestionIndex = -1;
  state.suggestions = buildSuggestions(normalizeSearchValue(state.draftSearch));
  renderAutocomplete();
});

elements.searchInput.addEventListener('focus', () => {
  state.autocompleteOpen = true;
  state.suggestions = buildSuggestions(normalizeSearchValue(state.draftSearch));
  renderAutocomplete();
});

elements.searchInput.addEventListener('keydown', (event) => {
  if (!state.suggestions.length) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    state.autocompleteOpen = true;
    state.activeSuggestionIndex =
      state.activeSuggestionIndex < state.suggestions.length - 1 ? state.activeSuggestionIndex + 1 : 0;
    renderAutocomplete();
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    state.autocompleteOpen = true;
    state.activeSuggestionIndex =
      state.activeSuggestionIndex > 0 ? state.activeSuggestionIndex - 1 : state.suggestions.length - 1;
    renderAutocomplete();
    return;
  }

  if (event.key === 'Enter' && state.activeSuggestionIndex >= 0) {
    event.preventDefault();
    const suggestion = state.suggestions[state.activeSuggestionIndex];
    if (suggestion) applySuggestion(suggestion);
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    applySearch(elements.searchInput.value);
    return;
  }

  if (event.key === 'Escape') {
    state.draftSearch = state.search;
    elements.searchInput.value = state.draftSearch;
    closeAutocomplete();
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.search--hero')) {
    closeAutocomplete();
  }
});

renderViewSwitch();
let topbarCondensed = false;

function updateTopbarState() {
  const y = window.scrollY;
  if (!topbarCondensed && y > 88) {
    topbarCondensed = true;
    elements.topbar.classList.add('is-scrolled');
  } else if (topbarCondensed && y < 28) {
    topbarCondensed = false;
    elements.topbar.classList.remove('is-scrolled');
  }
}

updateTopbarState();
window.addEventListener('scroll', updateTopbarState, { passive: true });
loadData().catch((error) => {
  elements.countryList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
});
