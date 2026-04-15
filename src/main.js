import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="page-shell">
    <header class="topbar" id="topbar">
      <div class="topbar__row topbar__row--main">
        <a class="topbar__brand" href="#" id="brandLink">
          <h1>The Edit Atlas</h1>
        </a>

        <label class="search search--hero" id="searchLabel">
          <button class="search__back" id="searchBack" type="button" aria-label="Clear search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <span class="sr-only">Search hotels</span>
          <input id="searchInput" type="search" placeholder="Search by property, city, country, or brand" />
          <button class="search__button" id="searchButton" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          <div id="autocomplete" class="autocomplete autocomplete--hidden"></div>
        </label>

        <div class="topbar__actions">
          <div class="refine-wrapper" id="refineWrapper">
            <button class="refine-toggle" id="refineToggle" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="11" cy="18" r="2" fill="currentColor"/></svg>
              Refine
              <span class="refine-toggle__badge" id="refineBadge"></span>
            </button>
            <div class="refine-panel" id="refinePanel"></div>
          </div>
          <div class="view-switch" id="viewSwitch"></div>
        </div>
      </div>
    </header>

    <main class="content">
      <section id="listView" class="content-view">
        <header class="editorial-hero">
          <button class="editorial-hero__back" id="heroBack" type="button" aria-label="Back to all hotels">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <h2>Explore</h2>
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

const COLLECTION_OPTIONS = [
  { key: 'the-edit', label: 'The Edit' },
  { key: 'select-credit', label: '$250 Credit Groups' },
  { key: 'editorial', label: 'Editorial Picks' },
];

const VIEW_MODES = [
  { key: 'list', label: 'List' },
  { key: 'map', label: 'Map' },
];

const state = {
  items: [],
  filtered: [],
  collections: new Set(['the-edit', 'select-credit', 'editorial']),
  search: '',
  draftSearch: '',
  viewMode: 'list',
  visibleCountries: COUNTRIES_PER_PAGE,
  autocompleteOpen: false,
  activeSuggestionIndex: -1,
  suggestions: [],
  filtersExpanded: false,
  filters: {
    starRatings: new Set([5, 4.5, 4]),
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
  refineWrapper: document.querySelector('#refineWrapper'),
  refinePanel: document.querySelector('#refinePanel'),
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
  document.querySelector('#searchLabel').classList.toggle('has-query', Boolean(state.search));
  document.querySelector('#heroBack').classList.toggle('is-visible', Boolean(state.search));
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
  // Collection filters (OR logic — item passes if it matches any selected collection)
  if (state.collections.size < 3) {
    let passesCollection = false;
    if (state.collections.has('the-edit')) passesCollection = true; // all items are The Edit
    if (state.collections.has('select-credit') && item.partnerGroup) passesCollection = true;
    if (state.collections.has('editorial') && item.publiclyConfirmedByChase) passesCollection = true;
    if (!passesCollection) return false;
  }

  const f = state.filters;
  if (!(f.starRatings.size === 3 && f.starRatings.has(5) && f.starRatings.has(4.5) && f.starRatings.has(4))) {
    const r = item.starRating || 0;
    let passesStars = false;
    for (const s of f.starRatings) {
      if (s === 5 && r === 5) passesStars = true;
      else if (s === 4.5 && r >= 4.5 && r < 5) passesStars = true;
      else if (s === 4 && r >= 4 && r < 4.5) passesStars = true;
      else if (s === 3.5 && r >= 3.5 && r < 4) passesStars = true;
    }
    if (!passesStars) return false;
  }
  if (item.priceValue != null && (item.priceValue < f.priceRange[0] || item.priceValue > f.priceRange[1])) return false;
  if (f.partnerBrands.length > 0 && !f.partnerBrands.includes(item.partnerGroup)) return false;
  if (f.chaseConfirmed && !item.publiclyConfirmedByChase) return false;
  if (f.tripAdvisorMin !== null && (item.tripAdvisorRating || 0) < f.tripAdvisorMin) return false;

  return true;
}

function activeFilterCount() {
  const f = state.filters;
  let count = 0;
  const defaultStars = f.starRatings.size === 3 && f.starRatings.has(5) && f.starRatings.has(4.5) && f.starRatings.has(4);
  if (!defaultStars) count++;
  if (f.priceRange[0] !== 335 || f.priceRange[1] !== 1250) count++;
  if (f.partnerBrands.length > 0) count++;
  if (state.collections.size < 3) count++;
  if (f.tripAdvisorMin !== null) count++;
  return count;
}

function resetFilters() {
  state.filters = {
    starRatings: new Set([5, 4.5, 4]),
    priceRange: [335, 1250],
    partnerBrands: [],
    chaseConfirmed: false,
    tripAdvisorMin: null,
  };
  state.collections = new Set(['the-edit', 'select-credit', 'editorial']);
  state.filtersExpanded = false;
  renderFilterDrawer();
  sync();
}

const STAR_OPTIONS = [
  { value: 5, label: '★★★★★' },
  { value: 4.5, label: '★★★★<span class="half-star">★</span>' },
  { value: 4, label: '★★★★' },
  { value: 3.5, label: '★★★<span class="half-star">★</span>' },
];

const TA_OWL = `<svg class="ta-owl" viewBox="0 0 512 512" width="14" height="14"><path d="M175.335 281.334c0 24.483-19.853 44.336-44.336 44.336-24.484 0-44.337-19.853-44.337-44.336 0-24.484 19.853-44.337 44.337-44.337 24.483 0 44.336 19.853 44.336 44.337zm205.554-44.337c-24.48 0-44.336 19.853-44.336 44.337 0 24.483 19.855 44.336 44.336 44.336 24.481 0 44.334-19.853 44.334-44.336-.006-24.47-19.839-44.31-44.309-44.323l-.025-.01v-.004zm125.002 44.337c0 68.997-55.985 124.933-124.999 124.933a124.466 124.466 0 01-84.883-33.252l-40.006 43.527-40.025-43.576a124.45 124.45 0 01-84.908 33.3c-68.968 0-124.933-55.937-124.933-124.932A124.586 124.586 0 0146.889 189L6 144.517h90.839c96.116-65.411 222.447-65.411 318.557 0H506l-40.878 44.484a124.574 124.574 0 0140.769 92.333zm-290.31 0c0-46.695-37.858-84.55-84.55-84.55-46.691 0-84.55 37.858-84.55 84.55 0 46.691 37.859 84.55 84.55 84.55 46.692 0 84.545-37.845 84.55-84.54v-.013.003zM349.818 155.1a244.01 244.01 0 00-187.666 0C215.532 175.533 256 223.254 256 278.893c0-55.634 40.463-103.362 93.826-123.786l-.005-.006h-.003zm115.64 126.224c0-46.694-37.858-84.55-84.55-84.55-46.691 0-84.552 37.859-84.552 84.55 0 46.692 37.855 84.55 84.553 84.55 46.697 0 84.55-37.858 84.55-84.55z" fill="currentColor" fill-rule="nonzero"/></svg>`;

const TA_OPTIONS = [
  { value: 4.5, label: '<span class="ta-dots">●●●●<span class="half-dot">●</span></span>' },
  { value: 4, label: '<span class="ta-dots">●●●●</span>' },
  { value: null, label: 'All' },
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

  elements.refineBadge.textContent = count > 0 ? count : '';
  elements.refineBadge.classList.toggle('is-visible', count > 0);
  elements.refineToggle.classList.toggle('is-active', state.filtersExpanded);
  elements.refineWrapper.classList.toggle('is-open', state.filtersExpanded);

  if (!state.filtersExpanded) {
    elements.refinePanel.innerHTML = '';
    return;
  }

  const collectionPills = COLLECTION_OPTIONS.map((opt) => {
    const active = state.collections.has(opt.key);
    return `<button class="fp-pill ${active ? 'is-active' : ''}" data-filter="collection" data-value="${opt.key}">${escapeHtml(opt.label)}</button>`;
  }).join('');

  const starPills = STAR_OPTIONS.map((opt) => {
    const active = f.starRatings.has(opt.value);
    return `<button class="fp-pill ${active ? 'is-active' : ''}" data-filter="star" data-value="${opt.value}">${opt.label}</button>`;
  }).join('');

  const taPills = TA_OPTIONS.map((opt) => {
    const active = f.tripAdvisorMin === opt.value;
    const cls = active ? (opt.value === null ? 'is-default' : 'is-active') : '';
    return `<button class="fp-pill ${cls}" data-filter="ta" data-value="${opt.value}">${opt.label}</button>`;
  }).join('');

  const brandChecks = PARTNER_BRANDS.map((brand) => {
    const short = brand.replace(/ Hotels?.*$/, '');
    const checked = f.partnerBrands.includes(brand);
    return `<label class="fp-check"><input type="checkbox" ${checked ? 'checked' : ''} data-filter="brand" data-value="${escapeHtml(brand)}" />${escapeHtml(short)}</label>`;
  }).join('');

  elements.refinePanel.innerHTML = `
    <div class="fp-section">
      <span class="fp-label">Collection</span>
      <div class="fp-row">${collectionPills}</div>
    </div>
    <div class="fp-section">
      <span class="fp-label">Price</span>
      <div class="fp-price-row">
        <span class="fp-price__wrap"><span class="fp-price__sign">$</span><input type="number" class="fp-price__field" min="335" max="1250" step="25" value="${f.priceRange[0]}" data-filter="price-text-min" /></span>
        <div class="fp-price__sliders">
          <input type="range" min="335" max="1250" step="25" value="${f.priceRange[0]}" data-filter="price-min" />
          <input type="range" min="335" max="1250" step="25" value="${f.priceRange[1]}" data-filter="price-max" />
        </div>
        <span class="fp-price__wrap"><span class="fp-price__sign">$</span><input type="number" class="fp-price__field" min="335" max="1250" step="25" value="${f.priceRange[1]}" data-filter="price-text-max" /></span>
      </div>
    </div>
    <div class="fp-section">
      <span class="fp-label">Star Rating</span>
      <div class="fp-row">${starPills}</div>
    </div>
    <div class="fp-section">
      <span class="fp-label">Brand</span>
      <div class="fp-brands">${brandChecks}</div>
    </div>
    <div class="fp-section">
      <span class="fp-label">Tripadvisor Rating</span>
      <div class="fp-row">${taPills}</div>
    </div>
    <div class="fp-footer">
      <button class="fp-apply" data-filter="apply">Apply</button>
      <button class="fp-clear" data-filter="clear">Clear all</button>
    </div>
  `;

  // Wire all filter interactions
  elements.refinePanel.querySelectorAll('[data-filter]').forEach((el) => {
    const type = el.dataset.filter;

    if (type === 'collection') {
      el.addEventListener('click', () => {
        const key = el.dataset.value;
        if (state.collections.has(key)) state.collections.delete(key);
        else state.collections.add(key);
        el.classList.toggle('is-active', state.collections.has(key));
      });
    } else if (type === 'star') {
      el.addEventListener('click', () => {
        const val = Number(el.dataset.value);
        if (state.filters.starRatings.has(val)) state.filters.starRatings.delete(val);
        else state.filters.starRatings.add(val);
        el.classList.toggle('is-active', state.filters.starRatings.has(val));
      });
    } else if (type === 'ta') {
      el.addEventListener('click', () => { state.filters.tripAdvisorMin = el.dataset.value === 'null' ? null : Number(el.dataset.value); renderFilterDrawer(); });
    } else if (type === 'brand') {
      // Don't re-render — just update state, checkbox handles its own visual
      el.addEventListener('change', () => {
        const brand = el.dataset.value;
        if (el.checked) { if (!f.partnerBrands.includes(brand)) f.partnerBrands.push(brand); }
        else { state.filters.partnerBrands = f.partnerBrands.filter((b) => b !== brand); }
      });
    } else if (type === 'apply') {
      el.addEventListener('click', () => { state.filtersExpanded = false; renderFilterDrawer(); sync(); });
    } else if (type === 'clear') {
      el.addEventListener('click', resetFilters);
    } else if (type === 'price-min' || type === 'price-max' || type === 'price-text-min' || type === 'price-text-max') {
      const thisType = type;
      const isSlider = thisType === 'price-min' || thisType === 'price-max';
      const syncPrice = () => {
        const p = elements.refinePanel;
        const minS = p.querySelector('[data-filter="price-min"]');
        const maxS = p.querySelector('[data-filter="price-max"]');
        const minT = p.querySelector('[data-filter="price-text-min"]');
        const maxT = p.querySelector('[data-filter="price-text-max"]');
        let min = Number(isSlider ? minS.value : minT.value) || 335;
        let max = Number(isSlider ? maxS.value : maxT.value) || 1250;
        min = Math.max(335, Math.min(1250, min));
        max = Math.max(335, Math.min(1250, max));
        if (min > max) { if (thisType.includes('min')) min = max; else max = min; }
        state.filters.priceRange = [min, max];
        minS.value = min; maxS.value = max; minT.value = min; maxT.value = max;
      };
      if (isSlider) {
        el.addEventListener('input', syncPrice);
      }
      el.addEventListener('change', syncPrice);
    }
  });
}

function propertyCardMarkup(item) {
  const eyebrow = item.partnerGroup
    ? escapeHtml(item.partnerGroup)
    : item.publiclyConfirmedByChase
      ? 'Featured by Chase'
      : null;

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
        ${eyebrow ? `<p class="property-card__eyebrow">${eyebrow}</p>` : ''}
        <h3>${escapeHtml(item.name)}</h3>
        <p class="property-card__location">${escapeHtml(item.location || [item.city, item.country].filter(Boolean).join(', '))}</p>
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
      const prevCount = state.visibleCountries;
      state.visibleCountries += COUNTRIES_PER_PAGE;
      renderCountryList();
      // Animate newly added country groups in
      const groups = elements.countryList.querySelectorAll('.country-group');
      groups.forEach((group, i) => {
        if (i >= prevCount) {
          group.classList.add('is-entering');
          requestAnimationFrame(() => group.classList.remove('is-entering'));
        }
      });
    });
  }
}

function renderStars(rating) {
  const full = Math.floor(rating);
  const hasHalf = rating % 1 >= 0.5;
  return '★'.repeat(full) + (hasHalf ? '<span class="half-star">★</span>' : '');
}

function popupMarkup(item) {
  const ratingLine = [
    escapeHtml(priceLabel(item)),
    item.starRating ? renderStars(item.starRating) : null,
  ].filter(Boolean).join('  ·  ');

  return `
    <article class="map-hover-card">
      ${
        item.image
          ? `<img class="map-hover-card__image" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" />`
          : ''
      }
      <div class="map-hover-card__body">
        <h3>${escapeHtml(item.name)}</h3>
        <p class="map-hover-card__location">${escapeHtml(
          item.location || [item.city, item.country].filter(Boolean).join(', '),
        )}</p>
        <p class="map-hover-card__detail">${ratingLine}</p>
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

const FADE_MS = 260;

function fadeOut(el) {
  return new Promise((resolve) => {
    el.classList.add('is-fading');
    setTimeout(resolve, FADE_MS);
  });
}

function fadeIn(el) {
  el.classList.remove('is-fading');
}

function activeView() {
  return state.viewMode === 'map' ? elements.mapView : elements.listView;
}

let firstRender = true;

function renderViewMode() {
  renderViewSwitch();
  const isMap = state.viewMode === 'map';
  const outgoing = isMap ? elements.listView : elements.mapView;
  const incoming = isMap ? elements.mapView : elements.listView;

  // First render: just show the right section immediately, no crossfade
  if (firstRender) {
    firstRender = false;
    outgoing.classList.add('content-view--hidden');
    incoming.classList.remove('content-view--hidden');
    if (isMap) { ensureMap(); requestAnimationFrame(() => updateMap()); }
    else { hideHoverPopup(); }
    return;
  }

  outgoing.classList.add('is-fading');
  window.scrollTo(0, 0);

  setTimeout(() => {
    outgoing.classList.add('content-view--hidden');
    outgoing.classList.remove('is-fading');

    incoming.classList.remove('content-view--hidden');
    incoming.classList.add('is-fading');

    if (isMap) {
      ensureMap();
      requestAnimationFrame(() => {
        updateMap();
        fadeIn(incoming);
      });
    } else {
      hideHoverPopup();
      requestAnimationFrame(() => fadeIn(incoming));
    }
  }, FADE_MS);
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

function sync({ animate = true } = {}) {
  renderFilterDrawer();
  state.visibleCountries = COUNTRIES_PER_PAGE;
  state.filtered = state.items.filter(matchesFilters);
  state.suggestions = buildSuggestions(normalizeSearchValue(state.draftSearch));
  renderAutocomplete();

  const view = activeView();

  const update = () => {
    renderCountryList();
    hideHoverPopup();
    buildClusterData(state.filtered);
    if (state.viewMode === 'map') updateMap();
    if (animate) requestAnimationFrame(() => fadeIn(view));
  };

  if (animate && view && !view.classList.contains('content-view--hidden')) {
    view.classList.add('is-fading');
    setTimeout(update, FADE_MS);
  } else {
    update();
  }
}

async function loadData() {
  const response = await fetch(`${import.meta.env.BASE_URL}data/properties.json`);
  if (!response.ok) {
    throw new Error(`Unable to load properties.json (${response.status})`);
  }

  const payload = await response.json();
  state.items = payload.properties;
  sync({ animate: false });
  renderViewMode();
}

elements.searchInput.addEventListener('input', (event) => {
  state.draftSearch = event.target.value.trim();
  // Native × clear button empties the value — auto-apply to reset to homepage
  if (!state.draftSearch && state.search) {
    applySearch('');
    return;
  }
  state.autocompleteOpen = true;
  state.activeSuggestionIndex = -1;
  state.suggestions = buildSuggestions(normalizeSearchValue(state.draftSearch));
  renderAutocomplete();
});

document.querySelector('#searchButton').addEventListener('click', () => {
  applySearch(elements.searchInput.value);
});

document.querySelector('#searchBack').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  applySearch('');
  elements.searchInput.value = '';
});

document.querySelector('#heroBack').addEventListener('click', () => {
  applySearch('');
  elements.searchInput.value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

document.querySelector('#brandLink').addEventListener('click', (e) => {
  e.preventDefault();
  if (state.viewMode !== 'list') {
    state.viewMode = 'list';
    renderViewMode();
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

elements.refineToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  state.filtersExpanded = !state.filtersExpanded;
  renderFilterDrawer();
});

elements.refinePanel.addEventListener('click', (e) => e.stopPropagation());

document.addEventListener('click', (e) => {
  if (state.filtersExpanded && !e.target.closest('.refine-wrapper')) {
    state.filtersExpanded = false;
    renderFilterDrawer();
  }
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
