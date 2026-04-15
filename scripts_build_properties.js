const fs = require('fs');
const path = require('path');

const ROOT = '/Users/agamjolly/Desktop/projects/chase';
const REPLIT_URL = 'https://hotels-with-the-edit.replit.app/';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function hashNumber(value) {
  let hash = 0;
  const str = String(value);
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function inferPartnerGroup(name) {
  const rules = [
    ['IHG Hotels & Resorts', /\b(intercontinental|kimpton|regent|six senses|vignette|hotel indigo|voco|hualuxe|crowne plaza|holiday inn|avid|atwell|staybridge|candlewood|iberostar)\b/i],
    ['Montage Hotels & Resorts', /\bmontage\b/i],
    ['Pendry Hotels & Resorts', /\bpendry\b/i],
    ['Omni Hotels & Resorts', /\b(omni|mokara)\b/i],
    ['Virgin Hotels', /\bvirgin\b/i],
    ['Minor Hotels', /\b(anantara|avani|nh collection|nhow|nh hotel|nh \b|oaks |tivoli|elewana)\b/i],
    ['Pan Pacific Hotels Group', /\b(pan pacific|parkroyal)\b/i],
  ];

  for (const [label, regex] of rules) {
    if (regex.test(name)) return label;
  }
  return null;
}

function inferLuxuryTier(name) {
  if (/\b(aman|cheval blanc|one&only|one and only|rosewood|raffles|peninsula|mandarin oriental|banyan tree|six senses|four seasons|st\. regis|montage|pendry|capella|amangani|amankila|amangiri)\b/i.test(name)) {
    return 'ultra';
  }
  if (/\b(ritz-carlton|waldorf astoria|park hyatt|andaz|auberge|belmond|edition|bulgari|bvlgari|faena|jumeirah|regent|fairmont|como|langham|rocco forte)\b/i.test(name)) {
    return 'luxury';
  }
  return 'upper';
}

function inferMarketBoost(location) {
  const text = String(location || '').toLowerCase();
  const rules = [
    [/\b(new york|london|paris|tokyo|hong kong|singapore|dubai|st\. barts|amalfi|capri|bora bora|maldives)\b/, 220],
    [/\b(aspen|los cabos|maui|kyoto|rome|barcelona|marrakech|lake como|santorini|ibiza|mallorca)\b/, 170],
    [/\b(san francisco|los angeles|chicago|miami|seoul|bangkok|napa|sydney)\b/, 120],
    [/\b(mexico|thailand|vietnam|portugal|spain|greece)\b/, 80],
  ];

  for (const [regex, boost] of rules) {
    if (regex.test(text)) return boost;
  }
  return 40;
}

function estimatePreviewRate(item) {
  const hash = hashNumber(item.id || item.name);
  const tier = inferLuxuryTier(item.name);
  const base =
    tier === 'ultra'
      ? 820
      : tier === 'luxury'
        ? 540
        : item.starRating >= 4.5
          ? 430
          : 295;

  const market = inferMarketBoost(item.location);
  const partnerBoost = inferPartnerGroup(item.name) ? 30 : 0;
  const spread = hash % 190;

  return Math.round((base + market + partnerBoost + spread) / 5) * 5;
}

function buildSummary(item) {
  const fragments = [];
  if (item.starRating) fragments.push(`${item.starRating}-star`);
  if (item.tripAdvisorRating) {
    fragments.push(`Tripadvisor ${item.tripAdvisorRating}/5 from ${item.tripAdvisorCount || 0} reviews`);
  }
  if (item.publiclyConfirmedByChase) fragments.push('Publicly confirmed in Chase editorial content');
  if (item.partnerGroup) fragments.push(`Matches Chase's ${item.partnerGroup} $250 credit partner group`);
  return fragments.join(' • ');
}

function main() {
  const replit = readJson(path.join(ROOT, 'data/replit-hotels.json'));
  const publicEdit = readJson(path.join(ROOT, 'data/public-edit-properties.json'));

  const chaseByName = new Map();
  for (const item of publicEdit) {
    const key = normalizeName(item.name);
    if (!key) continue;
    const current = chaseByName.get(key) || {
      collection: item.collection,
      sources: [],
    };
    for (const source of item.sources || [item.sourceUrl].filter(Boolean)) {
      if (source && !current.sources.includes(source)) current.sources.push(source);
    }
    chaseByName.set(key, current);
  }

  const properties = replit.map((item) => {
    const key = normalizeName(item.name);
    const chaseMatch = chaseByName.get(key);
    const partnerGroup = inferPartnerGroup(item.name);
    const priceValue = estimatePreviewRate(item);
    const sourceUrls = [REPLIT_URL];
    if (chaseMatch?.sources?.length) sourceUrls.push(...chaseMatch.sources);

    return {
      id: item.id,
      name: item.name,
      location: item.location,
      city: item.city,
      country: item.country,
      countryCode: item.countryCode,
      lat: item.coordinates?.[0] ?? null,
      lng: item.coordinates?.[1] ?? null,
      starRating: item.starRating,
      tripAdvisorRating: item.tripAdvisorRating,
      tripAdvisorCount: item.tripAdvisorCount,
      image: item.image,
      summary: buildSummary({
        ...item,
        partnerGroup,
        publiclyConfirmedByChase: Boolean(chaseMatch),
      }),
      description: item.description,
      collection: chaseMatch?.collection || 'The Edit by Chase Travel',
      partnerGroup,
      publiclyConfirmedByChase: Boolean(chaseMatch),
      creditSummary: partnerGroup
        ? 'The Edit benefits plus official $250-partner-brand overlap'
        : 'The Edit benefits',
      offerBucket: 'the-edit',
      priceValue,
      priceKind: 'preview',
      priceLabel: `$${priceValue}`,
      sourceUrls: [...new Set(sourceUrls)],
    };
  });

  properties.sort((a, b) => a.name.localeCompare(b.name));

  const analysis = {
    generatedAt: new Date().toISOString(),
    propertyCount: properties.length,
    countries: [...new Set(properties.map((item) => item.country))].length,
    chaseConfirmedCount: properties.filter((item) => item.publiclyConfirmedByChase).length,
    partnerOverlapCounts: properties.reduce((acc, item) => {
      if (!item.partnerGroup) return acc;
      acc[item.partnerGroup] = (acc[item.partnerGroup] || 0) + 1;
      return acc;
    }, {}),
  };

  writeJson(path.join(ROOT, 'public/data/properties.json'), { properties, analysis });
  writeJson(path.join(ROOT, 'data/properties.json'), { properties, analysis });
  writeJson(path.join(ROOT, 'data/properties-analysis.json'), analysis);
}

main();
