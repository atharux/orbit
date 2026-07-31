// App Store discovery — finds iOS publishers via Apple's public iTunes Search API.
//
// Why this exists: every other vertical discovers through OpenStreetMap, which is a
// map of physical places. App studios often have no mapped office, and OSM has no
// concept of "publishes iOS apps" — which is the only signal that actually qualifies
// a lead for App Review consulting. A studio that shipped an update last week is in a
// review cycle now. That is the whole targeting thesis.
//
// Uses the documented public endpoint (itunes.apple.com/search). No key, no scraping,
// no auth. Requests are serialised with a delay because the endpoint is rate limited
// (roughly 20 calls/minute) and hammering it gets you a 403 for a while.

import type { OsmBusiness } from './scraper'

/** One app as returned by the iTunes Search API, reduced to what we use. */
export interface StoreApp {
  trackId: number
  trackName: string
  sellerName: string
  sellerUrl?: string
  bundleId: string
  version: string
  currentVersionReleaseDate: string
  releaseDate: string
  primaryGenreName: string
  userRatingCount: number
  averageUserRating?: number
  price: number
}

/** A publisher, aggregated from their apps. This is what becomes a lead. */
export interface Publisher {
  sellerName: string
  sellerUrl?: string
  apps: StoreApp[]
  /** Most recent release date across all of their apps. */
  lastShipped: string
  /** Releases across all apps in the last 90 days — the review-frequency proxy. */
  recentReleases: number
  primaryGenre: string
  totalRatings: number
}

const ENDPOINT = 'https://itunes.apple.com/search';
const PAUSE_MS = 3000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Search the store. `term` is a keyword, `country` a two-letter store code.
 * The API caps at 200 results per call, so broad terms need several passes.
 */
export async function searchApps(
  term: string,
  country = 'de',
  limit = 200,
): Promise<StoreApp[]> {
  const url = `${ENDPOINT}?term=${encodeURIComponent(term)}&country=${country}&entity=software&limit=${Math.min(limit, 200)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes Search ${res.status} — likely rate limited, wait a minute`);
  const { results } = await res.json();
  return (results as Record<string, unknown>[]).map(r => ({
    trackId: r.trackId as number,
    trackName: (r.trackName as string) ?? '',
    sellerName: (r.sellerName as string) ?? '',
    sellerUrl: r.sellerUrl as string | undefined,
    bundleId: (r.bundleId as string) ?? '',
    version: (r.version as string) ?? '',
    currentVersionReleaseDate: (r.currentVersionReleaseDate as string) ?? '',
    releaseDate: (r.releaseDate as string) ?? '',
    primaryGenreName: (r.primaryGenreName as string) ?? '',
    userRatingCount: (r.userRatingCount as number) ?? 0,
    averageUserRating: r.averageUserRating as number | undefined,
    price: (r.price as number) ?? 0,
  })).filter(a => a.sellerName && a.trackName);
}

/** Group apps by publisher and compute the signals we actually target on. */
export function groupByPublisher(apps: StoreApp[]): Publisher[] {
  const now = Date.now();
  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
  const map = new Map<string, StoreApp[]>();

  for (const app of apps) {
    const key = app.sellerName.trim();
    if (!key) continue;
    map.set(key, [...(map.get(key) ?? []), app]);
  }

  return [...map.entries()].map(([sellerName, list]) => {
    const dates = list
      .map(a => a.currentVersionReleaseDate)
      .filter(Boolean)
      .sort()
      .reverse();
    const recentReleases = list.filter(a => {
      const t = Date.parse(a.currentVersionReleaseDate);
      return !Number.isNaN(t) && now - t < NINETY_DAYS;
    }).length;
    const genres = list.map(a => a.primaryGenreName).filter(Boolean);
    return {
      sellerName,
      sellerUrl: list.find(a => a.sellerUrl)?.sellerUrl,
      apps: list,
      lastShipped: dates[0] ?? '',
      recentReleases,
      primaryGenre: genres.sort((a, b) =>
        genres.filter(g => g === b).length - genres.filter(g => g === a).length)[0] ?? '',
      totalRatings: list.reduce((n, a) => n + a.userRatingCount, 0),
    };
  });
}

/**
 * Rank publishers by how likely they are to need App Review help.
 *
 * Shipping frequently is the dominant signal — every release is a review, and every
 * review is a chance to be rejected. Having several apps compounds it. Ratings volume
 * is a weak proxy for being an established business that can pay.
 */
export function scorePublisher(p: Publisher): number {
  const daysSince = p.lastShipped
    ? (Date.now() - Date.parse(p.lastShipped)) / 86_400_000
    : 9999;
  let score = 0;

  // Recency of the last release — every release is a review.
  if (daysSince < 7) score += 34;
  else if (daysSince < 14) score += 28;
  else if (daysSince < 30) score += 21;
  else if (daysSince < 90) score += 12;
  else if (daysSince < 180) score += 4;

  // Release cadence over the quarter.
  score += Math.min(p.recentReleases * 6, 24);

  // Portfolio size, banded. A publisher with two to eight apps is the target:
  // enough submissions to feel review pain, not big enough to employ someone
  // who handles it. Very large portfolios are platform holders and studios with
  // in-house compliance — they ship constantly and will never hire an outsider,
  // so counting apps linearly put Google at the top of the list. It is penalised.
  const n = p.apps.length;
  if (n >= 2 && n <= 8) score += 22;
  else if (n === 1) score += 6;
  else if (n <= 14) score += 8;
  else score -= 12;

  // Being an established business that can pay — but capped low, since ratings
  // volume mostly tracks consumer scale rather than willingness to buy services.
  if (p.totalRatings > 5000) score += 3;
  else if (p.totalRatings > 200) score += 6;
  else if (p.totalRatings > 20) score += 4;

  // A reachable website is what makes the lead actionable at all.
  if (p.sellerUrl) score += 8;

  return Math.max(0, score);
}

/** Human-readable reason a publisher scored where it did — shown in the UI. */
export function scoreReason(p: Publisher): string {
  const bits: string[] = [];
  if (p.lastShipped) {
    const d = Math.round((Date.now() - Date.parse(p.lastShipped)) / 86_400_000);
    bits.push(d < 1 ? 'shipped today' : `shipped ${d}d ago`);
  }
  if (p.recentReleases > 1) bits.push(`${p.recentReleases} releases in 90d`);
  if (p.apps.length > 1) bits.push(`${p.apps.length} apps`);
  return bits.join(' · ') || 'no recent activity';
}

/**
 * Discover publishers for a set of search terms, shaped as the same OsmBusiness the
 * rest of the pipeline already consumes — so enrichment, dedup and outreach need no
 * changes. `city` carries the store country, since these leads have no geography.
 */
export async function discoverViaAppStore(
  location: string,
  terms: string[],
  onProgress?: (msg: string) => void,
  minApps = 2,
): Promise<OsmBusiness[]> {
  const country = (location.trim().toLowerCase() || 'de').slice(0, 2);
  const all: StoreApp[] = [];

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i].replace(/^appstore:/, '');
    onProgress?.(`Searching "${term}" (${i + 1}/${terms.length})…`);
    try {
      all.push(...await searchApps(term, country));
    } catch (err) {
      onProgress?.(`"${term}" failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (i < terms.length - 1) await sleep(PAUSE_MS);
  }

  // De-duplicate by app id before grouping — terms overlap heavily.
  const unique = [...new Map(all.map(a => [a.trackId, a])).values()];
  const grouped = groupByPublisher(unique);
  // Single-app publishers are overwhelmingly one-off indie releases rather than
  // studios. Filtering them out is the difference between a list and a lead list.
  const publishers = grouped
    .filter(p => p.apps.length >= minApps)
    .sort((a, b) => scorePublisher(b) - scorePublisher(a));

  onProgress?.(
    `${unique.length} apps · ${grouped.length} publishers · ${publishers.length} with ${minApps}+ apps`,
  );

  return publishers.map((p, idx) => ({
    osm_id: -(idx + 1), // negative ids mark non-OSM origin
    osm_type: 'appstore',
    source: 'App Store',
    name: p.sellerName,
    lat: 0,
    lng: 0,
    category: p.primaryGenre || 'iOS Publisher',
    address: { country: country.toUpperCase() },
    website: p.sellerUrl,
    opening_hours: undefined,
    email: undefined,
    phone: undefined,
    // Carried through to the lead so the operator can judge it without opening the store.
    notes: scoreReason(p),
    appTitles: p.apps
      .slice()
      .sort((x, y) => (y.currentVersionReleaseDate ?? '').localeCompare(x.currentVersionReleaseDate ?? ''))
      .map(a => a.trackName),
    lastShipped: p.lastShipped,
    reviewScore: scorePublisher(p),
  } as AppStoreBusiness));
}

/** What App Store discovery returns — an OsmBusiness plus the publisher signals. */
export type AppStoreBusiness = OsmBusiness & {
  notes?: string
  appTitles?: string[]
  lastShipped?: string
  reviewScore?: number
}
