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
          <button class="search__button" id="searchButton" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          <div id="autocomplete" class="autocomplete autocomplete--hidden"></div>
        </label>

        <div class="topbar__actions">
          <button class="refine-toggle" id="refineToggle" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="11" cy="18" r="2" fill="currentColor"/></svg>
            Refine
            <span class="refine-toggle__badge" id="refineBadge"></span>
          </button>
          <div class="view-switch" id="viewSwitch"></div>
        </div>
      </div>

      <div class="topbar__row topbar__row--filters" id="filterDrawer">
        <div class="filter-drawer" id="filterDrawerInner"></div>
      </div>
    </header>

    <main class="content">
      <section id="listView" class="content-view">
        <header class="editorial-hero">
          <h2>Destinations</h2>
          <span class="editorial-hero__count"><span id="resultsCount">0</span> properties</span>
        </header>
        <div id="countryList" class="country-list"></div>
      </section>

      <section id="mapView" class="content-view content-view--hidden">
        <div class="map-frame">
          <div id="map"></div>
          <aside class="map-legend">
            <span class="legend__chip"><span class="legend__dot legend__dot--edit"></span> The Edit</span>
            <span class="legend__chip"><span class="legend__dot legend__dot--partner"></span> $250 Partner</span>
            <span class="legend__note">Preview prices</span>
          </aside>
        </div>
      </section>
    </main>
  </div>
`;

const COUNTRIES_PER_PAGE = 5;

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
  visibleCountries: COUNTRIES_PER_PAGE,
  autocompleteOpen: false,
  activeSuggestionIndex: -1,
  suggestions: [],
  filtersExpanded: false,
  filters: {
    starRating: null,
    priceRange: [335, 1250],
    partnerBrands: [],
    chaseConfirmed: false,
    tripAdvisorMin: null,
  },
};

const elements = {
  topbar: document.querySelector('#topbar'),
  viewSwitch: document.querySelector('#viewSwitch'),
  searchInput: document.querySelector('#searchInput'),
  autocomplete: document.querySelector('#autocomplete'),
  resultsCount: document.querySelector('#resultsCount'),
  countryList: document.querySelector('#countryList'),
  listView: document.querySelector('#listView'),
  mapView: document.querySelector('#mapView'),
  refineToggle: document.querySelector('#refineToggle'),
  refineBadge: document.querySelector('#refineBadge'),
  filterDrawer: document.querySelector('#filterDrawer'),
  filterDrawerInner: document.querySelector('#filterDrawerInner'),
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

  return [...countries, ...cities, ...hotels, ...groups].slice(0, 8);
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
  const isMap = state.viewMode === 'map';
  elements.viewSwitch.innerHTML = `
    <div class="view-toggle" role="radiogroup" aria-label="View mode">
      <button class="view-toggle__option ${!isMap ? 'is-active' : ''}" data-view="list" role="radio" aria-checked="${!isMap}">List</button>
      <button class="view-toggle__option ${isMap ? 'is-active' : ''}" data-view="map" role="radio" aria-checked="${isMap}">Map</button>
      <span class="view-toggle__slider" style="transform: translateX(${isMap ? '100%' : '0'})"></span>
    </div>
  `;

  elements.viewSwitch.querySelectorAll('.view-toggle__option').forEach((button) => {
    button.addEventListener('click', () => {
      state.viewMode = button.dataset.view;
      renderViewMode();
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

  const f = state.filters;
  if (f.starRating !== null && (item.starRating || 0) < f.starRating) return false;
  if (item.priceValue != null && (item.priceValue < f.priceRange[0] || item.priceValue > f.priceRange[1])) return false;
  if (f.partnerBrands.length > 0 && !f.partnerBrands.includes(item.partnerGroup)) return false;
  if (f.chaseConfirmed && !item.publiclyConfirmedByChase) return false;
  if (f.tripAdvisorMin !== null && (item.tripAdvisorRating || 0) < f.tripAdvisorMin) return false;

  return true;
}

function activeFilterCount() {
  const f = state.filters;
  let count = 0;
  if (f.starRating !== null) count++;
  if (f.priceRange[0] !== 335 || f.priceRange[1] !== 1250) count++;
  if (f.partnerBrands.length > 0) count++;
  if (f.chaseConfirmed) count++;
  if (f.tripAdvisorMin !== null) count++;
  return count;
}

function resetFilters() {
  state.filters = {
    starRating: null,
    priceRange: [335, 1250],
    partnerBrands: [],
    chaseConfirmed: false,
    tripAdvisorMin: null,
  };
  state.filtersExpanded = false;
  renderFilterDrawer();
  sync();
}

const STAR_OPTIONS = [
  { value: 5, label: '5★' },
  { value: 4.5, label: '4.5+' },
  { value: 4, label: '4+' },
  { value: null, label: 'All' },
];

const TA_OPTIONS = [
  { value: 4.5, label: '4.5+' },
  { value: 4, label: '4+' },
  { value: null, label: 'Any' },
];

const PARTNER_BRANDS = [
  'IHG Hotels & Resorts',
  'Montage Hotels & Resorts',
  'Pendry Hotels & Resorts',
  'Omni Hotels & Resorts',
  'Virgin Hotels',
  'Minor Hotels',
  'Pan Pacific Hotels Group',
];

const contentEl = document.querySelector('.content');
new ResizeObserver(() => {
  contentEl.style.paddingTop = `${elements.topbar.offsetHeight + 24}px`;
}).observe(elements.topbar);

function renderFilterDrawer() {
  const f = state.filters;
  const count = activeFilterCount();

  // Update badge
  elements.refineBadge.textContent = count > 0 ? count : '';
  elements.refineBadge.classList.toggle('is-visible', count > 0);

  // Update toggle state
  elements.refineToggle.classList.toggle('is-active', state.filtersExpanded);
  elements.filterDrawer.classList.toggle('is-expanded', state.filtersExpanded);

  if (!state.filtersExpanded) {
    elements.filterDrawerInner.innerHTML = '';

    return;
  }

  const starPills = STAR_OPTIONS.map((opt) => {
    const active = f.starRating === opt.value;
    return `<button class="filter-pill ${active ? 'is-active' : ''}" data-filter="star" data-value="${opt.value}">${opt.label}</button>`;
  }).join('');

  const taPills = TA_OPTIONS.map((opt) => {
    const active = f.tripAdvisorMin === opt.value;
    return `<button class="filter-pill ${active ? 'is-active' : ''}" data-filter="ta" data-value="${opt.value}">${opt.label}</button>`;
  }).join('');

  const brandPills = PARTNER_BRANDS.map((brand) => {
    const short = brand.replace(/ Hotels?.*$/, '');
    const active = f.partnerBrands.includes(brand);
    return `<button class="filter-pill ${active ? 'is-active' : ''}" data-filter="brand" data-value="${escapeHtml(brand)}">${escapeHtml(short)}</button>`;
  }).join('');

  const confirmedActive = f.chaseConfirmed;
  const priceActive = f.priceRange[0] !== 335 || f.priceRange[1] !== 1250;

  const offerPills = OFFER_FILTERS.map((opt) => {
    const active = state.offerFilter === opt.key;
    return `<button class="filter-pill ${active ? 'is-active' : ''}" data-filter="offer" data-value="${opt.key}">${escapeHtml(opt.label)}</button>`;
  }).join('');

  elements.filterDrawerInner.innerHTML = `
    <div class="filter-group">
      <span class="filter-group__label">Collection</span>
      <div class="filter-group__pills">${offerPills}</div>
    </div>
    <div class="filter-group filter-group--separator"></div>
    <div class="filter-group">
      <span class="filter-group__label">Stars</span>
      <div class="filter-group__pills">${starPills}</div>
    </div>
    <div class="filter-group">
      <span class="filter-group__label">Price</span>
      <div class="filter-group__pills">
        <div class="price-range">
          <input type="number" class="price-range__text" min="335" max="1250" step="25" value="${f.priceRange[0]}" data-filter="price-text-min" />
          <input type="range" class="price-range__input" min="335" max="1250" step="25" value="${f.priceRange[0]}" data-filter="price-min" />
          <span class="price-range__sep">–</span>
          <input type="range" class="price-range__input" min="335" max="1250" step="25" value="${f.priceRange[1]}" data-filter="price-max" />
          <input type="number" class="price-range__text" min="335" max="1250" step="25" value="${f.priceRange[1]}" data-filter="price-text-max" />
        </div>
      </div>
    </div>
    <div class="filter-group">
      <span class="filter-group__label">Brand</span>
      <div class="filter-group__pills">${brandPills}</div>
    </div>
    <div class="filter-group">
      <span class="filter-group__label">TripAdvisor</span>
      <div class="filter-group__pills">${taPills}</div>
    </div>
    <div class="filter-group">
      <button class="filter-pill ${confirmedActive ? 'is-active' : ''}" data-filter="confirmed">Chase Confirmed</button>
    </div>
    ${count > 0 ? '<button class="filter-clear" data-filter="clear">Clear all</button>' : ''}
  `;

  // Wire filter pill clicks
  elements.filterDrawerInner.querySelectorAll('[data-filter]').forEach((el) => {
    const type = el.dataset.filter;

    if (type === 'offer') {
      el.addEventListener('click', () => {
        state.offerFilter = el.dataset.value;
        renderFilterDrawer();
        sync();
      });
    } else if (type === 'star') {
      el.addEventListener('click', () => {
        const val = el.dataset.value === 'null' ? null : Number(el.dataset.value);
        state.filters.starRating = state.filters.starRating === val ? null : val;
        renderFilterDrawer();
        sync();
      });
    } else if (type === 'ta') {
      el.addEventListener('click', () => {
        const val = el.dataset.value === 'null' ? null : Number(el.dataset.value);
        state.filters.tripAdvisorMin = state.filters.tripAdvisorMin === val ? null : val;
        renderFilterDrawer();
        sync();
      });
    } else if (type === 'brand') {
      el.addEventListener('click', () => {
        const brand = el.dataset.value;
        const idx = state.filters.partnerBrands.indexOf(brand);
        if (idx >= 0) state.filters.partnerBrands.splice(idx, 1);
        else state.filters.partnerBrands.push(brand);
        renderFilterDrawer();
        sync();
      });
    } else if (type === 'confirmed') {
      el.addEventListener('click', () => {
        state.filters.chaseConfirmed = !state.filters.chaseConfirmed;
        renderFilterDrawer();
        sync();
      });
    } else if (type === 'clear') {
      el.addEventListener('click', resetFilters);
    } else if (type === 'price-min' || type === 'price-max' || type === 'price-text-min' || type === 'price-text-max') {
      const syncPrice = () => {
        const d = elements.filterDrawerInner;
        const minSlider = d.querySelector('[data-filter="price-min"]');
        const maxSlider = d.querySelector('[data-filter="price-max"]');
        const minText = d.querySelector('[data-filter="price-text-min"]');
        const maxText = d.querySelector('[data-filter="price-text-max"]');
        const isSlider = type === 'price-min' || type === 'price-max';
        let min = Number(isSlider ? minSlider.value : minText.value) || 335;
        let max = Number(isSlider ? maxSlider.value : maxText.value) || 1250;
        min = Math.max(335, Math.min(1250, min));
        max = Math.max(335, Math.min(1250, max));
        if (min > max) { if (type.includes('min')) min = max; else max = min; }
        state.filters.priceRange = [min, max];
        minSlider.value = min;
        maxSlider.value = max;
        minText.value = min;
        maxText.value = max;
      };
      el.addEventListener('input', syncPrice);
      el.addEventListener('change', () => { syncPrice(); sync(); });
    }
  });

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
        <p class="property-card__location">${escapeHtml(item.location || [item.city, item.country].filter(Boolean).join(', '))}</p>
        ${tags.length ? `<p class="property-card__note">${tags.join(' · ')}</p>` : ''}
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
  const visible = countries.slice(0, state.visibleCountries);
  const hasMore = countries.length > state.visibleCountries;

  elements.countryList.innerHTML = visible.length
    ? visible
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
        .join('') +
        (hasMore
          ? `<button class="load-more" id="loadMoreBtn">Load More</button>`
          : '')
    : `<div class="empty-state">No hotels match your current filters.</div>`;

  elements.countryList.querySelectorAll('.property-card').forEach((card) => {
    card.addEventListener('click', () => {
      const item = state.filtered.find((entry) => entry.id === card.dataset.id);
      if (item) openHotelSearch(item);
    });
  });

  const loadMoreBtn = document.querySelector('#loadMoreBtn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      state.visibleCountries += COUNTRIES_PER_PAGE;
      renderCountryList();
    });
  }
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
          tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'],
          tileSize: 256,
          attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
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

  let markerRafId = 0;
  function scheduleMarkerUpdate() {
    cancelAnimationFrame(markerRafId);
    markerRafId = requestAnimationFrame(renderMarkers);
  }

  map.on('load', () => {
    fitMapToItems();
    renderMarkers();
  });
  map.on('moveend', scheduleMarkerUpdate);
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
    requestAnimationFrame(() => updateMap());
  } else {
    hideHoverPopup();
  }
}

function updateMap() {
  if (!map) return;
  for (const [, marker] of markersOnScreen) marker.remove();
  markersOnScreen = new Map();
  markerCache.clear();
  buildClusterData(state.filtered);
  map.resize();
  fitMapToItems();
  renderMarkers();
}

function sync() {
  renderFilterDrawer();
  state.visibleCountries = COUNTRIES_PER_PAGE;
  state.filtered = state.items.filter(matchesFilters);
  state.suggestions = buildSuggestions(normalizeSearchValue(state.draftSearch));
  renderAutocomplete();
  renderCountryList();
  hideHoverPopup();
  buildClusterData(state.filtered);

  if (state.viewMode === 'map') {
    updateMap();
  }
}

async function loadData() {
  const response = await fetch(`${import.meta.env.BASE_URL}data/properties.json`);
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

document.querySelector('#searchButton').addEventListener('click', () => {
  applySearch(elements.searchInput.value);
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

elements.refineToggle.addEventListener('click', () => {
  state.filtersExpanded = !state.filtersExpanded;
  renderFilterDrawer();
});

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
