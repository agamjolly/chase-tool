const fs = require('fs');
const path = require('path');
const { htmlToText } = require('html-to-text');

const BASE = 'https://www.chase.com';
const listingFiles = [
  '/Users/agamjolly/Desktop/projects/chase/hotel_guides_page1.html',
  '/Users/agamjolly/Desktop/projects/chase/hotel_spotlights.html',
];

function readLinks(file) {
  const html = fs.readFileSync(file, 'utf8');
  return [...new Set([...html.matchAll(/\/travel\/guide\/hotels\/[^"?# ]+/g)].map(m => m[0]))]
    .filter(link => !link.endsWith('.jpg'));
}

function normalizeSpace(str) {
  return str.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function cleanLines(text) {
  return text
    .split('\n')
    .map(line => normalizeSpace(line))
    .filter(Boolean);
}

function looksGeneric(line) {
  return /^(Published|Chase Travel|Hotels?|Hotel Spotlight|Share to|Print this article|Booking With Chase Travel|Cardmember Benefits|Slide \d+|Show slide|Skip to main content|Personal|Business|Commercial|Schedule a meeting|Customer service|Search|Chase logo|Checking|Savings & CDs|Credit Cards|Mortgages|Auto|Chase for Business|Sports & Entertainment|Chase Security Center|About Chase|Investing by J\.P\. Morgan)$/i.test(line);
}

function looksLocationish(line) {
  return /(?:district|quarter|waterfront|village|ward|island|city|county|beach|heights|bay|bottom|wharf|downtown|uptown|old town|new town|center city|business district|gold coast|eixample|ciutat vella|georgetown|foggy bottom|dupont circle|adams morgan|penn quarter|the wharf|french quarter)$/i.test(
    line,
  ) || /^[A-Z][A-Z .,'&-]+,\s*[A-Z][A-Z .,'&-]+$/.test(line);
}

function looksLikeHotelName(line) {
  if (!line || looksGeneric(line)) return false;
  if (line.length > 120) return false;
  if (/^Check availability/i.test(line)) return false;
  if (looksLocationish(line)) return false;
  return true;
}

function collectionTypeFromLine(line) {
  if (/All-In Collection/i.test(line)) return 'The Edit All-In Collection';
  if (/Boutique Collection/i.test(line)) return 'The Edit Boutique Collection';
  if (/Hotel \+ Resort Collection/i.test(line)) return 'The Edit Hotel + Resort Collection';
  return 'The Edit by Chase Travel';
}

function extractFromLines(lines, url, pageTitle) {
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/member of The Edit|is a member of The Edit/i.test(line)) continue;

    let name = null;
    let location = null;
    let confidence = 'medium';

    // Pattern: "Hotel Name (Location)"
    const inlineHotel = line.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    const inlineMember = line.match(/^(.+?)\s+is a member of The Edit/i);

    if (inlineHotel) {
      name = inlineHotel[1].trim();
      location = inlineHotel[2].trim();
      confidence = 'high';
    } else if (inlineMember) {
      name = inlineMember[1].trim();
      confidence = 'high';
    } else {
      const prev1 = lines[i - 1];
      const prev2 = lines[i - 2];
      const prev3 = lines[i - 3];

      if (looksLikeHotelName(prev2)) {
        name = prev2;
        if (prev1 && !looksGeneric(prev1) && prev1.length < 80) {
          location = prev1;
        }
        confidence = 'high';
      } else if (looksLikeHotelName(prev1)) {
        const m = prev1.match(/^(.+?)\s*\(([^)]+)\)$/);
        if (m) {
          name = m[1].trim();
          location = m[2].trim();
          confidence = 'high';
        } else {
          name = prev1;
          confidence = 'medium';
        }
      } else if (looksLikeHotelName(prev3) && prev2 && !looksGeneric(prev2)) {
        name = prev3;
        location = prev2;
        confidence = 'medium';
      }
    }

    if (!name) {
      // Fallback: from page title for review-style pages.
      const titleMatch = pageTitle.match(/(?:Inside|At|Take a Sacred Nap in|Stay|Review:?\s*)(.+?)(?:,| Where| at | in |$)/i);
      if (titleMatch) {
        name = titleMatch[1].trim();
        confidence = 'low';
      }
    }

    if (!name) continue;

    results.push({
      name,
      location,
      collection: collectionTypeFromLine(line),
      sourceUrl: url,
      sourceTitle: pageTitle,
      evidenceLine: line,
      confidence,
    });
  }
  return results;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const html = await res.text();
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || url;
  const mainHtml = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html;
  const text = htmlToText(mainHtml, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
    preserveNewlines: true,
    uppercaseHeadings: false,
    hideLinkHrefIfSameAsText: true,
  });
  return { title, lines: cleanLines(text) };
}

async function main() {
  const articleLinks = [...new Set(listingFiles.flatMap(readLinks))].map(link => BASE + link);
  const all = [];
  const failures = [];
  console.log(`Scanning ${articleLinks.length} Chase hotel guide pages for public The Edit mentions...`);

  for (const [index, url] of articleLinks.entries()) {
    try {
      console.log(`[${index + 1}/${articleLinks.length}] ${url}`);
      const { title, lines } = await fetchText(url);
      const extracted = extractFromLines(lines, url, title);
      if (extracted.length) {
        console.log(`  -> found ${extracted.length} possible The Edit mention(s)`);
      }
      all.push(...extracted);
    } catch (err) {
      console.log(`  -> failed: ${String(err)}`);
      failures.push({ url, error: String(err) });
    }
  }

  const deduped = [];
  const byKey = new Map();
  for (const item of all) {
    const key = item.name.toLowerCase();
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, item);
      continue;
    }
    if (!current.location && item.location) current.location = item.location;
    current.sources = current.sources || [current.sourceUrl];
    if (!current.sources.includes(item.sourceUrl)) current.sources.push(item.sourceUrl);
    if (item.confidence === 'high' && current.confidence !== 'high') {
      Object.assign(current, item, { sources: current.sources });
    }
  }

  for (const value of byKey.values()) {
    if (!looksLikeHotelName(value.name)) continue;
    deduped.push({
      name: value.name,
      location: value.location || null,
      collection: value.collection,
      confidence: value.confidence,
      sourceTitle: value.sourceTitle,
      sourceUrl: value.sourceUrl,
      sources: value.sources || [value.sourceUrl],
    });
  }

  deduped.sort((a, b) => a.name.localeCompare(b.name));

  const outDir = '/Users/agamjolly/Desktop/projects/chase/data';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'public-edit-properties.json'), JSON.stringify(deduped, null, 2));
  fs.writeFileSync(path.join(outDir, 'public-edit-failures.json'), JSON.stringify(failures, null, 2));

  console.log(JSON.stringify({
    articleCount: articleLinks.length,
    extractedCount: all.length,
    uniqueCount: deduped.length,
    sample: deduped.slice(0, 20),
    failures: failures.slice(0, 10),
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
