(() => {
  'use strict';

  const STORAGE_KEY = 'crrcfSettings';
  const METADATA_CACHE_KEY = 'crrcfAniListMetadata';
  const WIDTH_LEVELS = ['original', 0.20, 0.10, 0.05, 0];
  const WIDTH_LABELS = ['Original', '20% borders', '10% borders', '5% borders', 'Full'];
  const COUNTRY_AUDIO_CODES = { JP: 'JA', CN: 'ZH', KR: 'KO' };
  const LANGUAGES = [
    ['JA', 'Japanese'], ['EN', 'English'], ['PT', 'Portuguese'], ['ES', 'Spanish'],
    ['FR', 'French'], ['DE', 'German'], ['IT', 'Italian'], ['KO', 'Korean'],
    ['ZH', 'Chinese'], ['HI', 'Hindi'], ['TH', 'Thai'], ['RU', 'Russian'],
    ['PL', 'Polish'], ['AR', 'Arabic'], ['ID', 'Indonesian'], ['TA', 'Tamil'],
    ['TE', 'Telugu'], ['MS', 'Malay'], ['TR', 'Turkish'], ['UK', 'Ukrainian'],
    ['TL', 'Tagalog']
  ];
  const COMMON_LANGS = new Set(['JA', 'EN', 'PT', 'ES', 'FR', 'DE', 'IT', 'KO', 'ZH']);
  // Origin countries offered in Title Options; every other country is grouped as OTHER_COUNTRY.
  // To offer another country (say TW), add a line here and nothing else.
  const TITLE_COUNTRIES = [['JP', 'Japan'], ['CN', 'China'], ['KR', 'Korea']];
  const OTHER_COUNTRY = 'OTHER';
  const NO_COUNTRY_MESSAGE = 'Global titles are shown. Pick a country to show romanized titles.';
  const LOOKUP_NOTICE = 'Titles are looked up on AniList (graphql.anilist.co) to find each show\u2019s country of origin.';
  const DEFAULTS = {
    selectedLanguages: ['JA'],
    hiddenCounters: true,
    time24h: false,
    // Countries whose shows get their romanized title ('JP', 'CN', 'KR' or 'OTHER'). Empty = off.
    romanizeCountries: [],
    alignCards: true,
    includeUnknownLanguages: false,
    hidePremiereBadges: true,
    // Off by default: it is the only calendar feature that needs AniList lookups.
    keepOriginalAudio: false,
    calendarWidthLevel: 2,
    truncateTitles: true
  };
  // Bump when a stored setting changes meaning and needs a one-time migration.
  const SCHEMA_VERSION = 2;
  // Version of the AniList cache records (v2: romaji saved for every country, not only JP).
  const CACHE_RECORD_VERSION = 2;
  let settings = { ...DEFAULTS, schemaVersion: SCHEMA_VERSION };
  let applying = false;
  let queued = false;
  let calendarObserver = null;
  let titleObserver = null;
  // Which feature set is currently running: 'calendar', 'series', 'watch' or 'other'.
  let activeKind = 'other';
  // Track the exact text-node values written by this extension so its own
  // characterData records never schedule another title pass.
  const ownTitleTextMutations = new WeakMap();
  const api = globalThis.browser || globalThis.chrome;

  function storageGet(key) {
    return new Promise(resolve => {
      const storage = api?.storage?.local;
      if (!storage) return resolve(null);
      try {
        if (globalThis.browser?.storage?.local === storage) {
          storage.get(key).then(data => resolve(data?.[key] ?? null)).catch(() => resolve(null));
        } else {
          storage.get(key, data => resolve(data?.[key] ?? null));
        }
      } catch (_) { resolve(null); }
    });
  }

  async function loadSettings() {
    return await storageGet(STORAGE_KEY);
  }
  function saveSettings() {
    try {
      const result = api?.storage?.local?.set({ [STORAGE_KEY]: settings });
      if (result?.catch) result.catch(() => {});
    } catch (_) {}
  }

  function normalizeCode(value) {
    const s = String(value || '').trim().toUpperCase().replace(/_/g, '-');
    const aliases = {
      'JA-JP': 'JA', 'EN-US': 'EN', 'EN-GB': 'EN', 'PT-BR': 'PT', 'PT-PT': 'PT',
      'ES-ES': 'ES', 'ES-LA': 'ES', 'ES-419': 'ES', 'FR-FR': 'FR', 'DE-DE': 'DE',
      'IT-IT': 'IT', 'KO-KR': 'KO', 'ZH-CN': 'ZH', 'ZH-TW': 'ZH', 'HI-IN': 'HI',
      'TH-TH': 'TH', 'RU-RU': 'RU', 'PL-PL': 'PL', 'AR-SA': 'AR', 'ID-ID': 'ID',
      'TA-IN': 'TA', 'TE-IN': 'TE', 'MS-MY': 'MS', 'TR-TR': 'TR', 'UK-UA': 'UK',
      'TL-PH': 'TL', 'FIL-PH': 'TL'
    };
    return aliases[s] || (LANGUAGES.some(x => x[0] === s) ? s : null);
  }

  // Language-independent: the card's audio button carries the full list in its
  // aria-label ("Audio languages: EN, ES, KO, JA"), whatever the UI language is,
  // so read everything after the first colon instead of matching the label text.
  const CODE_TOKEN = /^[A-Z]{2,3}(?:-[A-Z0-9]{2,4})?$/;
  function languageInfoFromTokens(tokens) {
    const codes = new Set();
    let hasUnknown = false;
    for (const token of tokens) {
      const code = normalizeCode(token);
      if (code) codes.add(code); else hasUnknown = true;
    }
    return { codes: [...codes], hasMetadata: true, hasUnknown };
  }

  function parseAudioLabel(label) {
    const text = String(label || '');
    const colon = text.search(/[:：]/);
    if (colon < 0) return null;
    const tokens = text.slice(colon + 1).split(/[,،、，;/|]+/)
      .map(raw => raw.trim().toUpperCase()).filter(token => CODE_TOKEN.test(token));
    return languageInfoFromTokens(tokens);
  }

  // Cards with a single audio language have no audio button; the language only
  // appears in the card's screen-reader sentence, for example
  // "Watch Show, Drop time: 10:00, Season 1, episode 6, Audio languages: JA, Release 3 of 8".
  // Take the last "<label>: CODE" segment plus the code-shaped segments after it,
  // so nothing depends on the (translated) wording of the label.
  function parseScreenReaderLanguages(text) {
    const parts = String(text || '').split(/\s*[,،、，]\s*/);
    for (let i = parts.length - 1; i >= 0; i--) {
      const first = parts[i].match(/[:：]\s*(\S+)$/)?.[1];
      if (!first || !CODE_TOKEN.test(first)) continue;
      const tokens = [first];
      for (let j = i + 1; j < parts.length && CODE_TOKEN.test(parts[j].trim()); j++) tokens.push(parts[j].trim());
      return languageInfoFromTokens(tokens);
    }
    return null;
  }

  function getLanguageInfo(card) {
    const labelled = parseAudioLabel(card.querySelector("[data-t='audio-languages']")?.getAttribute('aria-label'));
    if (labelled) return labelled;
    for (const node of card.querySelectorAll("[data-t='sr-only']")) {
      const spoken = parseScreenReaderLanguages(node.textContent);
      if (spoken) return spoken;
    }
    // Fallbacks for markup without that button: the redesigned calendar can
    // expose audio information as plain card text
    // (for example "Idiomas de áudio: FR") without a dedicated data-t node.
    // Prefer this explicit, release-specific label over generic card metadata.
    const text = card.textContent || '';
    const explicitAudioLabels = [...text.matchAll(/(?:Idiomas?\s+de\s+[áa]udio|Audio\s+languages?)\s*:\s*([A-Z]{2,3}(?:-[A-Z0-9]{2,3})?(?:\s*[,/|]\s*[A-Z]{2,3}(?:-[A-Z0-9]{2,3})?)*)/g)];
    if (explicitAudioLabels.length) {
      const codes = new Set();
      let hasUnknown = false;
      for (const match of explicitAudioLabels) {
        for (const token of match[1].toUpperCase().split(/\s*[,/|]\s*/)) {
          const code = normalizeCode(token);
          if (code) codes.add(code);
          else hasUnknown = true;
        }
      }
      return { codes: [...codes], hasMetadata: true, hasUnknown };
    }
    const nodes = [...card.querySelectorAll("[data-t='audio-languages'], [data-t='audio-language'], [aria-label*='Audio languages'], [aria-label*='audio language']")];
    if (!nodes.length) return { codes: [], hasMetadata: false, hasUnknown: false };
    const raw = nodes.map(node => [node.getAttribute('aria-label') || '', node.textContent || '', node.getAttribute('title') || ''].join(' ')).join(' ').toUpperCase();
    const result = new Set();
    const labels = {
      JAPANESE: 'JA', ENGLISH: 'EN', PORTUGUESE: 'PT', SPANISH: 'ES', FRENCH: 'FR',
      GERMAN: 'DE', ITALIAN: 'IT', KOREAN: 'KO', CHINESE: 'ZH', HINDI: 'HI',
      THAI: 'TH', RUSSIAN: 'RU', POLISH: 'PL', ARABIC: 'AR', INDONESIAN: 'ID',
      TAMIL: 'TA', TELUGU: 'TE', MALAY: 'MS', TURKISH: 'TR', UKRAINIAN: 'UK',
      TAGALOG: 'TL', FILIPINO: 'TL'
    };
    for (const token of (raw.match(/[A-Z]{2,3}(?:-[A-Z]{2,3})?/g) || [])) {
      const code = normalizeCode(token);
      if (code) result.add(code);
    }
    for (const [label, code] of Object.entries(labels)) if (raw.includes(label)) result.add(code);

    // Inspect only the actual audio-language labels for unknown locale codes.
    // Avoid treating UI words such as AUDIO/LANGUAGES or the hidden-count (+2) as locales.
    const declared = nodes.map(node => `${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`)
      .join(' ').toUpperCase().replace(/AUDIO\s+LANGUAGES?:?/g, ' ');
    const candidates = declared.match(/\b[A-Z]{2,3}(?:-[A-Z]{2,3})?\b/g) || [];
    const ignored = new Set(['AUDIO', 'LANGUAGE', 'LANGUAGES', 'PLUS', 'HIDDEN', 'RELEASE']);
    const hasUnknown = candidates.some(token => !ignored.has(token) && !normalizeCode(token) && !/^S[0-9]$/.test(token));
    return { codes: [...result], hasMetadata: true, hasUnknown };
  }

  function getLanguageCodes(card) { return getLanguageInfo(card).codes; }

  const getCards = () => [...document.querySelectorAll("[data-t='release-calendar-card']")];
  function cardCell(card) { return card.closest("[data-t='release-cell']") || card; }

  let romajiTitleStatus = 'Looks up each show on AniList (sends its title to graphql.anilist.co).';
  const metadataByTitle = new Map();
  const metadataPending = new Map();
  let metadataSaveQueued = false;
  const metadataAttempted = new Set();
  let anilistLastRequestAt = 0;
  let anilistRequestQueue = Promise.resolve();
  const runtimeLogs = [];
  let activeAniListScans = 0;
  function updateAniListActivity() {
    const indicator = document.getElementById('crrcf-anilist-progress');
    if (indicator) {
      indicator.hidden = activeAniListScans <= 0;
      indicator.setAttribute('aria-label', activeAniListScans > 0 ? 'AniList lookup in progress' : '');
      indicator.title = activeAniListScans > 0 ? 'Searching AniList…' : '';
    }
  }
  function refreshAfterAniListResponse() {
    queueApply();
    if (romajiEnabled()) requestAnimationFrame(() => applyRomajiFromCache());
  }
  function recentLogLines() {
    const cutoff = Date.now() - 120000;
    while (runtimeLogs.length && runtimeLogs[runtimeLogs.length - 1].at < cutoff) runtimeLogs.pop();
    return runtimeLogs.map(entry => entry.line);
  }
  function addRuntimeLog(message) {
    const timestamp = new Date();
    runtimeLogs.unshift({ at: timestamp.getTime(), line: `[${timestamp.toLocaleTimeString()}] ${message}` });
    if (runtimeLogs.length > 100) runtimeLogs.length = 100;
    const output = document.getElementById('crrcf-logs-output');
    if (output) output.value = recentLogLines().join('\n');
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  // AniList allows 90 requests/minute, but documents a temporary degraded limit of
  // 30/minute; 2.1 s between requests stays under both.
  const ANILIST_MIN_INTERVAL_MS = 2100;
  const ANILIST_DEFAULT_PAUSE_MS = 60000;
  const ANILIST_MAX_PAUSE_MS = 300000;

  // Serialize AniList requests. On HTTP 429, pause the whole queue (for the
  // Retry-After time when the browser exposes that header, otherwise one minute)
  // and retry this exact request before allowing the next title to proceed.
  function anilistRequest(query, variables) {
    const run = async () => {
      while (true) {
        const wait = Math.max(0, ANILIST_MIN_INTERVAL_MS - (Date.now() - anilistLastRequestAt));
        if (wait) await sleep(wait);
        anilistLastRequestAt = Date.now();
        const response = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ query, variables })
        });
        let rateLimited = response.status === 429;
        if (!rateLimited && response.ok) {
          try {
            const envelope = await response.clone().json();
            rateLimited = (envelope?.errors || []).some(error => error?.status === 429 || /too many requests/i.test(error?.message || ''));
          } catch (_) {}
        }
        if (!rateLimited) return response;
        // Retry-After is only readable if AniList exposes it through CORS.
        const retryAfterSeconds = Number(response.headers.get('Retry-After'));
        const pauseMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(ANILIST_MAX_PAUSE_MS, retryAfterSeconds * 1000 + 1000)
          : ANILIST_DEFAULT_PAUSE_MS;
        addRuntimeLog(`AniList rate limit reached (HTTP 429). Pausing all lookups for ${Math.round(pauseMs / 1000)} seconds, then retrying this same title.`);
        await sleep(pauseMs);
      }
    };
    const task = anilistRequestQueue.then(run, run);
    anilistRequestQueue = task.catch(() => {});
    return task;
  }

  function titleKey(text) {
    return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[Яя]/g, m => m === 'Я' ? 'R' : 'r').trim().toLocaleLowerCase()
      .replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  // AniList search is accent-sensitive for some titles. Strip diacritics only
  // from the outbound search term; keep original titles everywhere else.
  function normalizeAniListSearch(title) {
    return String(title || '').normalize('NFKD').replace(/\p{M}/gu, '');
  }

  function saveMetadataCache() {
    if (metadataSaveQueued) return;
    metadataSaveQueued = true;
    setTimeout(() => {
      metadataSaveQueued = false;
      try {
        const serializable = Object.fromEntries(metadataByTitle.entries());
        const result = api?.storage?.local?.set({ [METADATA_CACHE_KEY]: serializable });
        if (result?.catch) result.catch(() => {});
      } catch (_) {}
    }, 250);
  }

  async function loadMetadataCache() {
    const result = await storageGet(METADATA_CACHE_KEY);
    for (const [key, value] of Object.entries(result || {})) {
      if (!value || typeof value !== 'object' || !value.crunchyrollTitle || !value.countryOfOrigin) continue;
      // Before v2, romaji was only saved for Japanese shows: look non-JP entries up again.
      if (value.v !== CACHE_RECORD_VERSION && value.countryOfOrigin !== 'JP' && !value.romajiTitle) continue;
      metadataByTitle.set(key, value);
    }
  }

  async function lookupAniListMetadata(crunchyrollTitle) {
    const key = titleKey(crunchyrollTitle);
    if (!key) return null;
    if (metadataByTitle.has(key)) return metadataByTitle.get(key);
    if (metadataPending.has(key)) return metadataPending.get(key);
    const pending = (async () => {
      const query = `query ($search: String!, $type: MediaType) { Page(perPage: 50) { media(search: $search, type: $type) { id type countryOfOrigin synonyms title { english romaji native } } } }`;
      // ANIME only: a second MANGA request for every unmatched title doubled the
      // traffic for little benefit. Add 'MANGA' back here to restore it.
      for (const type of ['ANIME']) {
        try {
          const response = await anilistRequest(query, { search: normalizeAniListSearch(crunchyrollTitle), type });
          if (!response?.ok) {
            refreshAfterAniListResponse();
            addRuntimeLog(`[${crunchyrollTitle}] [${type}] AniList request failed: HTTP ${response?.status ?? 'unknown'}.`);
            continue;
          }
          const envelope = await response.json();
          refreshAfterAniListResponse();
          if (envelope?.errors?.length) {
            for (const error of envelope.errors) addRuntimeLog(`[${crunchyrollTitle}] [${type}] AniList error: ${error.message || 'Unknown GraphQL error'}.`);
          }
          const results = envelope?.data?.Page?.media || [];
          let exact = results.find(item => [item.title?.english, item.title?.romaji, item.title?.native, ...(item.synonyms || [])]
            .some(candidate => titleKey(candidate) === key));
          if (!exact?.countryOfOrigin) {
            addRuntimeLog(`[${crunchyrollTitle}] [${type}] Not Found on AniList.`);
            continue;
          }
          const record = {
            crunchyrollTitle,
            // Any country: for Chinese/Korean shows AniList's "romaji" is the pinyin/romanisation.
            romajiTitle: exact.title?.romaji && !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(exact.title.romaji) ? exact.title.romaji : null,
            countryOfOrigin: exact.countryOfOrigin,
            anilistId: exact.id,
            anilistType: exact.type,
            v: CACHE_RECORD_VERSION
          };
          metadataByTitle.set(key, record);
          saveMetadataCache();
          return record;
        } catch (error) {
          refreshAfterAniListResponse();
          addRuntimeLog(`[${crunchyrollTitle}] [${type}] AniList request error: ${error?.message || error}.`);
        }
      }
      return null;
    })().finally(() => metadataPending.delete(key));
    metadataPending.set(key, pending);
    return pending;
  }

  function getOriginalAudioCode(record) {
    return record ? COUNTRY_AUDIO_CODES[record.countryOfOrigin] || null : null;
  }

  function updateRomajiTitleStatus() {
    const status = document.getElementById('crrcf-romaji-title-status');
    if (status) status.textContent = romajiTitleStatus;
  }

  function collectSeriesFromCards() {
    const unique = new Map();
    for (const card of getCards()) {
      const link = card.querySelector('[data-t="series-page-link"]');
      const id = link?.getAttribute('href')?.match(/\/series\/([^/?#]+)/)?.[1];
      if (!link || !id) continue;
      const href = link.getAttribute('href') || '';
      if (!link.dataset.crrcfEnglishTitle || link.dataset.crrcfEnglishHref !== href) {
        link.dataset.crrcfEnglishTitle = link.textContent.trim();
        link.dataset.crrcfEnglishHref = href;
      }
      const title = link.dataset.crrcfEnglishTitle;
      if (!unique.has(titleKey(title))) unique.set(titleKey(title), { id, title, links: [] });
      unique.get(titleKey(title)).links.push(link);
    }
    return [...unique.values()];
  }

  let metadataScanPromise = null;
  let metadataScanRerunRequested = false;
  // AniList is only contacted while a feature that needs it is switched on, so a
  // default install sends nothing to third parties.
  function romajiEnabled() { return settings.romanizeCountries.length > 0; }
  // The romanized title to show for this record, or null when its country is not selected.
  function romajiFor(record) {
    if (!record?.romajiTitle) return null;
    const country = TITLE_COUNTRIES.some(([code]) => code === record.countryOfOrigin) ? record.countryOfOrigin : OTHER_COUNTRY;
    return settings.romanizeCountries.includes(country) ? record.romajiTitle : null;
  }
  function anilistFeaturesEnabled() { return Boolean(romajiEnabled() || settings.keepOriginalAudio); }

  async function scanAniListMetadata() {
    if (!anilistFeaturesEnabled()) {
      romajiTitleStatus = NO_COUNTRY_MESSAGE;
      updateRomajiTitleStatus();
      return;
    }
    if (metadataScanPromise) { metadataScanRerunRequested = true; return metadataScanPromise; }
    metadataScanPromise = (async () => {
      activeAniListScans++;
      updateAniListActivity();
      const items = collectSeriesFromCards();
      const missing = items.filter(item => !metadataByTitle.has(titleKey(item.title)) && !metadataAttempted.has(titleKey(item.title)));
      if (!missing.length) {
        romajiTitleStatus = `AniList metadata: ${metadataByTitle.size} titles saved; no new lookups needed.`;
        updateRomajiTitleStatus();
        return;
      }
      let completed = 0, found = 0, missed = 0;
      romajiTitleStatus = `AniList metadata: checking 0/${missing.length} new titles…`;
      updateRomajiTitleStatus();
      for (const item of missing) {
        metadataAttempted.add(titleKey(item.title));
        try {
          const record = await lookupAniListMetadata(item.title);
          if (record) found++; else missed++;
        } catch (_) { missed++; }
        completed++;
        refreshAfterAniListResponse();
        romajiTitleStatus = `AniList metadata: ${found} found, ${missed} not matched (${completed}/${missing.length} new titles).`;
        updateRomajiTitleStatus();
      }
    })().finally(() => {
      activeAniListScans = Math.max(0, activeAniListScans - 1);
      updateAniListActivity();
      metadataScanPromise = null;
      queueApply();
      if (romajiEnabled()) requestAnimationFrame(() => applyRomajiFromCache());
      if (metadataScanRerunRequested) {
        metadataScanRerunRequested = false;
        Promise.resolve().then(() => scanAniListMetadata());
      }
    });
    return metadataScanPromise;
  }

  function applyRomajiFromCache() {
    const items = collectSeriesFromCards();
    let found = 0, missing = 0;
    for (const item of items) {
      const record = metadataByTitle.get(titleKey(item.title));
      const romaji = romajiEnabled() ? romajiFor(record) : null;
      if (romaji) {
        found++;
        for (const link of item.links) if (link.textContent !== romaji) link.textContent = romaji;
      } else {
        // Not selected (or no match): show the global title again.
        if (romajiEnabled() && !record?.romajiTitle) missing++;
        for (const link of item.links) if (link.textContent !== item.title) link.textContent = item.title;
      }
    }
    if (romajiEnabled()) {
      romajiTitleStatus = `Romanized titles: ${found} shown, ${missing} not matched (${items.length} titles in calendar).`;
    } else {
      romajiTitleStatus = NO_COUNTRY_MESSAGE;
    }
    updateRomajiTitleStatus();
    requestAnimationFrame(() => {
      if (activeKind !== 'calendar') return;
      if (settings.alignCards) applyAlignment();
      if (settings.truncateTitles) document.documentElement.classList.add('crrcf-truncate-titles');
    });
  }

  async function applyRomajiTitles() {
    if (!romajiEnabled()) {
      applyRomajiFromCache();
      updateRomajiTitleStatus();
      return;
    }
    applyRomajiFromCache();
    await scanAniListMetadata();
    if (romajiEnabled()) applyRomajiFromCache();
  }

  function applyFilters() {
    if (applying || activeKind !== 'calendar') return;
    applying = true;
    try {
      for (const card of getCards()) {
        const cell = cardCell(card);
        if (cell.dataset.crrcfOriginalDisplay === undefined) cell.dataset.crrcfOriginalDisplay = cell.style.display || '';
        const info = getLanguageInfo(card);
        const originalRecord = metadataByTitle.get(titleKey(card.querySelector('[data-t="series-page-link"]')?.dataset.crrcfEnglishTitle || card.querySelector('[data-t="series-page-link"]')?.textContent));
        const originalCode = settings.keepOriginalAudio ? getOriginalAudioCode(originalRecord) : null;
        let visible = info.codes.some(code => settings.selectedLanguages.includes(code))
          || (settings.keepOriginalAudio && originalCode && info.codes.includes(originalCode))
          || (settings.includeUnknownLanguages && info.hasUnknown)
          || !info.hasMetadata
          || (info.codes.length === 0 && !info.hasUnknown);
        cell.dataset.crrcfHidden = visible ? '0' : '1';
        cell.style.display = visible ? cell.dataset.crrcfOriginalDisplay : 'none';
        const premiere = card.querySelector('[data-t="premiere-tag"]');
        card.classList.toggle('crrcf-has-premiere', Boolean(premiere));
        if (premiere) premiere.style.display = settings.hidePremiereBadges ? 'none' : '';
      }
      document.documentElement.classList.toggle('crrcf-align-cards', settings.alignCards);
      document.documentElement.classList.toggle('crrcf-truncate-titles', settings.truncateTitles);
      document.documentElement.classList.toggle('crrcf-hide-premiere', settings.hidePremiereBadges);
      applyAlignment();
      renderCounters();
    } finally { applying = false; }
  }

  function applyAlignment() {
    const allCells = [...document.querySelectorAll("[data-t='release-cell']")];
    for (const cell of allCells) cell.style.minHeight = '';
    if (!settings.alignCards) return;

    // Measure after badge visibility and image layout have been applied. The premiere tag
    // occupies space above the thumbnail in the card's link wrapper, so hide/measure it
    // consistently before setting common heights for each visual row.
    const days = [...document.querySelectorAll("[data-t='day-column']")];
    const visibleRows = days.map(day => [...day.querySelectorAll("[data-t='release-cell']")]
      .filter(cell => cell.dataset.crrcfHidden !== '1' && cell.style.display !== 'none'));
    const maxRows = Math.max(0, ...visibleRows.map(rows => rows.length));
    for (let index = 0; index < maxRows; index++) {
      const row = visibleRows.map(rows => rows[index]).filter(Boolean);
      const maxHeight = Math.max(0, ...row.map(cell => {
        const card = cell.querySelector("[data-t='release-calendar-card']");
        if (!card) return Math.ceil(cell.getBoundingClientRect().height);
        const rect = card.getBoundingClientRect();
        return Math.ceil(rect.height);
      }));
      if (maxHeight > 0) for (const cell of row) cell.style.minHeight = `${maxHeight}px`;
    }
  }

  function queueApply() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; applyFilters(); });
  }

  function renderCounters() {
    document.querySelectorAll('.crrcf-hidden-count').forEach(node => node.remove());
    if (!settings.hiddenCounters) return;
    for (const day of document.querySelectorAll("[data-t='day-column']")) {
      const count = [...day.querySelectorAll("[data-t='release-calendar-card']")]
        .filter(card => cardCell(card).dataset.crrcfHidden === '1').length;
      const header = day.querySelector('.day-header, [data-t="day-header"], h2, h3') || day.firstElementChild;
      if (!header) continue;
      const label = document.createElement('div');
      label.className = 'crrcf-hidden-count';
      label.textContent = `${count} ${count === 1 ? 'card' : 'cards'} hidden`;
      header.append(label);
    }
  }

  function makeSwitch(id, label, checked, onChange) {
    const row = document.createElement('label');
    row.className = 'crrcf-setting-row';
    row.htmlFor = id;
    const title = document.createElement('span');
    title.className = 'crrcf-setting-label';
    title.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox'; input.id = id; input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    const track = document.createElement('span'); track.className = 'crrcf-toggle';
    row.append(title, input, track);
    return row;
  }

  function renderLanguages() {
    const root = document.getElementById('crrcf-languages');
    if (!root) return;
    root.replaceChildren();
    for (const [code, name] of LANGUAGES) {
      const label = document.createElement('label');
      label.className = 'crrcf-language-chip' + (settings.selectedLanguages.includes(code) ? ' is-selected' : '');
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = settings.selectedLanguages.includes(code);
      input.setAttribute('aria-label', `${name} (${code})`);
      input.addEventListener('change', () => {
        if (input.checked && !settings.selectedLanguages.includes(code)) settings.selectedLanguages.push(code);
        if (!input.checked) settings.selectedLanguages = settings.selectedLanguages.filter(x => x !== code);
        label.classList.toggle('is-selected', input.checked);
        updateLanguageSummary(); saveSettings(); queueApply();
      });
      const codeText = document.createElement('span'); codeText.className = 'crrcf-language-code'; codeText.textContent = code;
      const nameText = document.createElement('span'); nameText.className = 'crrcf-language-name'; nameText.textContent = name;
      label.append(input, codeText, nameText); root.append(label);
    }
    const others = document.createElement('label');
    others.className = 'crrcf-language-chip' + (settings.includeUnknownLanguages ? ' is-selected' : '');
    const othersInput = document.createElement('input'); othersInput.type = 'checkbox'; othersInput.checked = settings.includeUnknownLanguages;
    othersInput.setAttribute('aria-label', 'Others (include unrecognized audio languages)');
    const othersCode = document.createElement('span'); othersCode.className = 'crrcf-language-code'; othersCode.textContent = '??';
    const othersName = document.createElement('span'); othersName.className = 'crrcf-language-name'; othersName.textContent = 'Others';
    othersInput.addEventListener('change', () => { settings.includeUnknownLanguages = othersInput.checked; others.classList.toggle('is-selected', settings.includeUnknownLanguages); updateLanguageSummary(); saveSettings(); queueApply(); });
    others.append(othersInput, othersCode, othersName); root.append(others);
  }

  function renderCountries() {
    const root = document.getElementById('crrcf-countries');
    if (!root) return;
    root.replaceChildren();
    for (const [code, name] of [...TITLE_COUNTRIES, [OTHER_COUNTRY, 'Others']]) {
      const selected = settings.romanizeCountries.includes(code);
      const label = document.createElement('label');
      label.className = 'crrcf-language-chip crrcf-country-chip' + (selected ? ' is-selected' : '');
      label.title = code === OTHER_COUNTRY ? 'Shows made in any other country' : `Shows made in ${name}`;
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected;
      input.setAttribute('aria-label', label.title);
      input.addEventListener('change', () => {
        settings.romanizeCountries = input.checked
          ? [...new Set([...settings.romanizeCountries, code])]
          : settings.romanizeCountries.filter(x => x !== code);
        label.classList.toggle('is-selected', input.checked);
        updateTitleSummary(); saveSettings(); applyRomajiTitles();
      });
      const nameText = document.createElement('span'); nameText.className = 'crrcf-language-name'; nameText.textContent = name;
      label.append(input, nameText); root.append(label);
    }
  }

  function updateTitleSummary() {
    const summary = document.getElementById('crrcf-title-summary');
    if (summary) summary.textContent = `${settings.romanizeCountries.length}/${TITLE_COUNTRIES.length + 1} selected`;
  }

  function setNativeTime(value) {
    const input = document.querySelector('input[name="release-calendar-time-format"]');
    if (input && Boolean(input.checked) !== Boolean(value)) input.click();
  }

  function applyCalendarSize() {
    const root = document.documentElement;
    const calendar = document.querySelector('.erc-release-calendar');
    const parsedLevel = Number(settings.calendarWidthLevel);
    const level = Number.isFinite(parsedLevel) ? Math.max(0, Math.min(WIDTH_LEVELS.length - 1, parsedLevel)) : 0;
    root.classList.remove('crrcf-wide-calendar');
    root.style.removeProperty('--crrcf-calendar-inset');
    if (level === 0 || !calendar) return;
    root.classList.add('crrcf-wide-calendar');
    root.style.setProperty('--crrcf-calendar-inset', `${Math.round(WIDTH_LEVELS[level] * 100)}vw`);
  }

  function retryUnmatchedMetadata() {
    const items = collectSeriesFromCards();
    for (const item of items) {
      const key = titleKey(item.title);
      if (!metadataByTitle.has(key)) metadataAttempted.delete(key);
    }
    romajiTitleStatus = 'Retrying AniList lookups for unmatched titles…';
    updateRomajiTitleStatus();
    scanAniListMetadata().then(() => {
      if (romajiEnabled()) applyRomajiFromCache();
      queueApply();
    });
  }

  function renderMemoryEditor() {
    const editor = document.getElementById('crrcf-memory-editor');
    const textarea = document.getElementById('crrcf-memory-json');
    if (!editor || !textarea) return;
    editor.hidden = false;
    document.querySelector('#crrcf-panel [aria-label="Edit Memory"]')?.classList.add('is-active');
    textarea.value = JSON.stringify(Object.fromEntries(metadataByTitle.entries()), null, 2);
  }

  function saveEditedMemory() {
    const textarea = document.getElementById('crrcf-memory-json');
    const status = document.getElementById('crrcf-memory-status');
    try {
      const parsed = JSON.parse(textarea.value || '{}');
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Memory must be a JSON object.');
      const next = new Map();
      for (const [rawKey, value] of Object.entries(parsed)) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || !value.crunchyrollTitle || typeof value.countryOfOrigin !== 'string') {
          throw new Error(`Invalid entry: ${rawKey}`);
        }
        const key = titleKey(value.crunchyrollTitle);
        if (!key) throw new Error(`Invalid title: ${rawKey}`);
        next.set(key, {
          crunchyrollTitle: String(value.crunchyrollTitle),
          romajiTitle: value.romajiTitle ? String(value.romajiTitle) : null,
          countryOfOrigin: String(value.countryOfOrigin).toUpperCase(),
          anilistId: value.anilistId ?? null,
          anilistType: value.anilistType ?? null,
          v: CACHE_RECORD_VERSION
        });
      }
      metadataByTitle.clear();
      for (const [key, value] of next) metadataByTitle.set(key, value);
      metadataAttempted.clear();
      const serialized = Object.fromEntries(metadataByTitle.entries());
      const result = api?.storage?.local?.set({ [METADATA_CACHE_KEY]: serialized });
      if (result?.catch) result.catch(() => {});
      document.getElementById('crrcf-memory-editor').hidden = true;
      document.querySelector('#crrcf-panel [aria-label="Edit Memory"]')?.classList.remove('is-active');
      if (romajiEnabled()) applyRomajiFromCache();
      queueApply();
      if (status) status.textContent = `${metadataByTitle.size} entries saved.`;
      updateRomajiTitleStatus();
    } catch (error) {
      if (status) status.textContent = `Could not save: ${error.message}`;
    }
  }

  function resetMetadataMemory() {
    if (!confirm('Reset all saved AniList metadata? This cannot be undone.')) return;
    metadataByTitle.clear();
    metadataAttempted.clear();
    const result = api?.storage?.local?.set({ [METADATA_CACHE_KEY]: {} });
    if (result?.catch) result.catch(() => {});
    const status = document.getElementById('crrcf-memory-status');
    if (status) status.textContent = 'Memory reset.';
    if (romajiEnabled()) applyRomajiFromCache();
    queueApply();
    scanAniListMetadata().then(() => { if (romajiEnabled()) applyRomajiFromCache(); queueApply(); });
  }

  function showRuntimeLogs() {
    const viewer = document.getElementById('crrcf-logs-viewer');
    const output = document.getElementById('crrcf-logs-output');
    if (!viewer || !output) return;
    viewer.hidden = !viewer.hidden;
    document.querySelector('#crrcf-panel [aria-label="View recent logs"]')?.classList.toggle('is-active', !viewer.hidden);
    const lines = recentLogLines();
    output.value = lines.length ? lines.join('\n') : 'No recent errors or unmatched AniList results.';
  }

  function buildPanel() {
    let panel = document.getElementById('crrcf-panel');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'crrcf-panel'; panel.hidden = true;
    panel.innerHTML = `
      <div class="crrcf-panel-head"><div><div class="crrcf-eyebrow">RELEASE CALENDAR</div><strong>Display Settings</strong></div><button type="button" id="crrcf-close" aria-label="Close settings">×</button></div>
      <details class="crrcf-language-details crrcf-accordion">
        <summary>Audio Options <span id="crrcf-language-summary"></span></summary>
        <div class="crrcf-section-head"><p class="crrcf-section-hint">Show releases with these audio languages</p><div class="crrcf-language-actions"><button type="button" id="crrcf-all">All</button><button type="button" id="crrcf-none">None</button></div></div>
        <div id="crrcf-languages" class="crrcf-languages"></div>
        <div id="crrcf-original-audio-slot"></div>
      </details>
      <details class="crrcf-language-details crrcf-accordion crrcf-title-options">
        <summary>Title Options <span id="crrcf-title-summary" class="crrcf-section-summary"></span></summary>
        <div class="crrcf-section-head"><p class="crrcf-section-hint">Show original (romanized) titles of shows made in:</p><div class="crrcf-language-actions"><button type="button" id="crrcf-country-all">All</button><button type="button" id="crrcf-country-none">None</button></div></div>
        <div id="crrcf-countries" class="crrcf-languages"></div>
        <div id="crrcf-title-settings"></div>
      </details>
      <details class="crrcf-language-details crrcf-accordion crrcf-style-options">
        <summary>Style Options</summary>
        <div id="crrcf-style-settings"></div>
      </details>
      <div class="crrcf-section-divider" aria-hidden="true"></div>
      <div class="crrcf-settings-list"></div>
      <div id="crrcf-logs-viewer" class="crrcf-logs-viewer" hidden><textarea id="crrcf-logs-output" readonly spellcheck="false" aria-label="Recent application logs"></textarea></div>`;
    document.body.append(panel);
    panel.querySelector('#crrcf-close').addEventListener('click', () => { panel.hidden = true; clearPanelTransientMessages(); });
    panel.querySelector('#crrcf-all').addEventListener('click', () => { settings.selectedLanguages = LANGUAGES.map(x => x[0]); settings.includeUnknownLanguages = true; renderLanguages(); saveSettings(); queueApply(); updateLanguageSummary(); });
    panel.querySelector('#crrcf-none').addEventListener('click', () => { settings.selectedLanguages = []; settings.includeUnknownLanguages = false; renderLanguages(); saveSettings(); queueApply(); updateLanguageSummary(); });
    const setCountries = codes => { settings.romanizeCountries = codes; renderCountries(); updateTitleSummary(); saveSettings(); applyRomajiTitles(); };
    panel.querySelector('#crrcf-country-all').addEventListener('click', () => setCountries([...TITLE_COUNTRIES.map(([code]) => code), OTHER_COUNTRY]));
    panel.querySelector('#crrcf-country-none').addEventListener('click', () => setCountries([]));
    const list = panel.querySelector('.crrcf-settings-list');
    const styleList = panel.querySelector('#crrcf-style-settings');
    const titleList = panel.querySelector('#crrcf-title-settings');
    function addSettingBlock(parent, row, statusId = null, statusText = '', extraClass = '') {
      const block = document.createElement('div');
      block.className = `crrcf-setting-block ${extraClass}`.trim();
      block.append(row);
      if (statusId) {
        const status = document.createElement('p');
        status.id = statusId; status.className = 'crrcf-setting-status'; status.textContent = statusText;
        block.append(status);
      }
      parent.append(block);
      return block;
    }
    addSettingBlock(styleList, makeSwitch('crrcf-hidden-counters', 'Show hidden counters', settings.hiddenCounters, value => { settings.hiddenCounters = value; saveSettings(); queueApply(); }));
    addSettingBlock(styleList, makeSwitch('crrcf-align-cards', 'Align cards', settings.alignCards, value => { settings.alignCards = value; saveSettings(); queueApply(); }));
    addSettingBlock(styleList, makeSwitch('crrcf-hide-premiere', 'Hide PREMIERE labels', settings.hidePremiereBadges, value => { settings.hidePremiereBadges = value; saveSettings(); queueApply(); requestAnimationFrame(() => { if (settings.alignCards) applyAlignment(); }); }));
    const retryButton = document.createElement('button');
    retryButton.type = 'button'; retryButton.className = 'crrcf-icon-action crrcf-romaji-retry'; retryButton.innerHTML = '<span aria-hidden="true">↻</span>'; retryButton.setAttribute('aria-label', 'Retry unmatched AniList lookups');
    retryButton.title = 'Retry AniList lookups for titles without a saved match';
    retryButton.addEventListener('click', retryUnmatchedMetadata);
    romajiTitleStatus = romajiEnabled() ? LOOKUP_NOTICE : NO_COUNTRY_MESSAGE;
    const statusBlock = document.createElement('div');
    statusBlock.className = 'crrcf-setting-block';
    const statusText = document.createElement('p');
    statusText.id = 'crrcf-romaji-title-status'; statusText.className = 'crrcf-setting-status'; statusText.textContent = romajiTitleStatus;
    statusBlock.append(statusText);
    titleList.append(statusBlock);
    addSettingBlock(titleList, makeSwitch('crrcf-truncate-titles', 'Limit long titles', settings.truncateTitles, value => { settings.truncateTitles = value; document.documentElement.classList.toggle('crrcf-truncate-titles', value); saveSettings(); queueApply(); requestAnimationFrame(() => { if (settings.alignCards) applyAlignment(); }); }));
    const timeBlock = addSettingBlock(styleList, makeSwitch('crrcf-time24', '24-hour time', settings.time24h, value => { settings.time24h = value; setNativeTime(value); saveSettings(); }), null, '', 'crrcf-time-block');
    const timezoneNote = document.createElement('div'); timezoneNote.className = 'crrcf-timezone-note'; timeBlock.append(timezoneNote);

    addSettingBlock(panel.querySelector('#crrcf-original-audio-slot'), makeSwitch('crrcf-original-audio', 'Always show original-audio releases', settings.keepOriginalAudio, value => {
      settings.keepOriginalAudio = value; saveSettings(); queueApply();
      if (value) scanAniListMetadata().then(() => queueApply());
    }), 'crrcf-original-audio-note', 'Looks up each show on AniList (sends its title to graphql.anilist.co).');

    const widthBlock = document.createElement('div');
    widthBlock.className = 'crrcf-width-control';
    const widthHeading = document.createElement('div'); widthHeading.className = 'crrcf-width-heading';
    const widthLabel = document.createElement('strong'); widthLabel.textContent = 'Calendar size';
    const widthValue = document.createElement('span'); widthValue.id = 'crrcf-width-value';
    widthHeading.append(widthLabel, widthValue);
    const widthSlider = document.createElement('input'); widthSlider.type = 'range'; widthSlider.min = '0'; widthSlider.max = String(WIDTH_LEVELS.length - 1); widthSlider.step = '1'; widthSlider.value = String(settings.calendarWidthLevel);
    widthSlider.id = 'crrcf-width-slider'; widthSlider.setAttribute('aria-label', 'Calendar size');
    widthSlider.addEventListener('pointerdown', event => {
      // Treat pointer interaction as a single click: update once at pointer-down and
      // cancel the browser's native thumb-drag behavior.
      event.preventDefault();
      const rect = widthSlider.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const nextLevel = Math.round(ratio * (WIDTH_LEVELS.length - 1));
      widthSlider.value = String(nextLevel);
      settings.calendarWidthLevel = nextLevel;
      widthValue.textContent = WIDTH_LABELS[nextLevel];
      applyCalendarSize();
      saveSettings();
      queueApply();
      requestAnimationFrame(() => positionPanel(document.getElementById('crrcf-panel'), document.getElementById('crrcf-gear')));
    });
    widthSlider.addEventListener('input', () => {
      settings.calendarWidthLevel = Number(widthSlider.value);
      widthValue.textContent = WIDTH_LABELS[settings.calendarWidthLevel];
      applyCalendarSize();
    });
    widthSlider.addEventListener('change', () => { saveSettings(); queueApply(); });
    widthBlock.append(widthHeading, widthSlider);
    list.append(widthBlock);

    const memoryBlock = document.createElement('div');
    memoryBlock.className = 'crrcf-memory-controls';
    const memoryActions = document.createElement('div'); memoryActions.className = 'crrcf-memory-actions';
    const logsButton = document.createElement('button'); logsButton.type = 'button'; logsButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>'; logsButton.title = 'View recent logs'; logsButton.setAttribute('aria-label', 'View recent logs'); logsButton.className = 'crrcf-icon-action'; logsButton.addEventListener('click', showRuntimeLogs);
    const editButton = document.createElement('button'); editButton.type = 'button'; editButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>'; editButton.title = 'Edit Memory'; editButton.setAttribute('aria-label', 'Edit Memory'); editButton.className = 'crrcf-icon-action'; editButton.addEventListener('click', renderMemoryEditor);
    const resetButton = document.createElement('button'); resetButton.type = 'button'; resetButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg>'; resetButton.title = 'Reset Memory'; resetButton.setAttribute('aria-label', 'Reset Memory'); resetButton.className = 'crrcf-icon-action'; resetButton.addEventListener('click', resetMetadataMemory);
    memoryActions.append(logsButton, retryButton, editButton, resetButton);
    const editor = document.createElement('div'); editor.id = 'crrcf-memory-editor'; editor.hidden = true;
    const textarea = document.createElement('textarea'); textarea.id = 'crrcf-memory-json'; textarea.spellcheck = false; textarea.setAttribute('aria-label', 'AniList metadata memory JSON');
    const editorActions = document.createElement('div'); editorActions.className = 'crrcf-memory-actions';
    const saveMemory = document.createElement('button'); saveMemory.type = 'button'; saveMemory.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l4 4v14H3V3h2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></svg>'; saveMemory.title = 'Save Memory'; saveMemory.setAttribute('aria-label', 'Save Memory'); saveMemory.className = 'crrcf-inline-action crrcf-primary-action'; saveMemory.addEventListener('click', saveEditedMemory);
    const cancelMemory = document.createElement('button'); cancelMemory.type = 'button'; cancelMemory.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg>'; cancelMemory.title = 'Cancel'; cancelMemory.setAttribute('aria-label', 'Cancel'); cancelMemory.className = 'crrcf-inline-action'; cancelMemory.addEventListener('click', () => { editor.hidden = true; document.querySelector('#crrcf-panel [aria-label="Edit Memory"]')?.classList.remove('is-active'); });
    editorActions.append(saveMemory, cancelMemory);
    editor.append(textarea, editorActions);
    const memoryStatus = document.createElement('p'); memoryStatus.id = 'crrcf-memory-status'; memoryStatus.className = 'crrcf-setting-status';
    memoryBlock.append(memoryActions, editor, memoryStatus);
    list.append(memoryBlock);

    renderLanguages(); updateLanguageSummary(); renderCountries(); updateTitleSummary(); updateRomajiTitleStatus();
    widthValue.textContent = WIDTH_LABELS[settings.calendarWidthLevel] || 'Original';
    return panel;
  }

  function updateLanguageSummary() {
    const summary = document.getElementById('crrcf-language-summary');
    if (summary) summary.textContent = `${settings.selectedLanguages.length + (settings.includeUnknownLanguages ? 1 : 0)}/${LANGUAGES.length + 1} selected`;
  }

  // Remember where the site's timezone note lived so it can be put back when the
  // panel goes away (React expects to find it in its original parent).
  let timezoneNoteHome = null;
  function moveTimezoneNote() {
    const note = document.querySelector('.timezone-controls .timezone-note, .timezone-note');
    const destination = document.querySelector('#crrcf-panel .crrcf-timezone-note');
    if (note && destination && note.parentElement !== destination) {
      timezoneNoteHome = { note, parent: note.parentElement, next: note.nextSibling };
      destination.append(note);
    }
  }
  function restoreTimezoneNote() {
    const home = timezoneNoteHome;
    timezoneNoteHome = null;
    if (!home?.parent?.isConnected) return;
    const next = home.next && home.next.parentNode === home.parent ? home.next : null;
    home.parent.insertBefore(home.note, next);
  }

  function positionPanel(panel, gear) {
    if (!panel || !gear || panel.hidden) return;
    const rect = gear.getBoundingClientRect();
    if (gear.classList.contains('crrcf-floating-gear')) {
      panel.classList.add('crrcf-panel-fixed');
      panel.style.top = `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - Math.min(panel.offsetHeight || 300, window.innerHeight - 24)))}px`;
      panel.style.left = 'auto';
      panel.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
    } else {
      panel.classList.remove('crrcf-panel-fixed');
      const left = Math.max(window.scrollX + 12, Math.min(rect.right + window.scrollX - panel.offsetWidth, window.scrollX + window.innerWidth - panel.offsetWidth - 12));
      panel.style.left = `${left}px`;
      panel.style.right = 'auto';
      panel.style.top = `${rect.bottom + window.scrollY + 8}px`;
    }
  }

  function gearSvg() { return '⚙'; }

  function attachGear() {
    if (!document.body) return;
    const panel = buildPanel();
    let gear = document.getElementById('crrcf-gear');
    let progress = document.getElementById('crrcf-anilist-progress');
    if (!progress) { progress = document.createElement('span'); progress.id = 'crrcf-anilist-progress'; progress.className = 'crrcf-anilist-progress'; progress.hidden = true; progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite'); progress.title = 'Searching AniList…'; }
    if (!gear) {
      gear = document.createElement('button');
      gear.id = 'crrcf-gear'; gear.type = 'button'; gear.textContent = gearSvg();
      gear.title = 'Release calendar settings'; gear.setAttribute('aria-label', gear.title);
      gear.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        if (panel.hidden) clearPanelTransientMessages();
        if (!panel.hidden) {
          clearPanelTransientMessages();
          positionPanel(panel, gear);
          renderLanguages();
        }
      });
    }

    // The gear replaces the native 24-hour switch in the exact same control slot.
    const timeArea = document.querySelector('.timezone-controls');
    const nativeToggles = [...document.querySelectorAll('.erc-time-format-toggle')];
    for (const toggle of nativeToggles) {
      toggle.classList.add('crrcf-native-time-proxy');
      toggle.setAttribute('aria-hidden', 'true');
    }
    if (timeArea) {
      timeArea.classList.add('crrcf-timearea');
      progress.classList.remove('crrcf-floating-progress');
      if (progress.parentElement !== timeArea) timeArea.append(progress);
      if (gear.parentElement !== timeArea) timeArea.append(gear);
      gear.classList.remove('crrcf-floating-gear');
      moveTimezoneNote();
    } else {
      const header = document.querySelector('.erc-release-calendar .header, .erc-release-calendar header, [data-t="release-calendar-content"] header');
      progress.classList.add('crrcf-floating-progress');
      if (progress.parentElement !== (header || document.body)) (header || document.body).append(progress);
      if (gear.parentElement !== (header || document.body)) (header || document.body).append(gear);
      gear.classList.add('crrcf-floating-gear');
    }
    updateAniListActivity();
  }

  function clearPanelTransientMessages() {
    const status = document.getElementById('crrcf-memory-status');
    if (status) status.textContent = '';
    const editor = document.getElementById('crrcf-memory-editor');
    if (editor) editor.hidden = true;
    const logs = document.getElementById('crrcf-logs-viewer');
    if (logs) logs.hidden = true;
    document.querySelector('#crrcf-panel [aria-label="Edit Memory"]')?.classList.remove('is-active');
    document.querySelector('#crrcf-panel [aria-label="View recent logs"]')?.classList.remove('is-active');
  }


  // Crunchyroll prefixes non-English URLs with a locale: /pt-br/series/…, /de/watch/…
  const LOCALE_PREFIX = '(?:/[a-z]{2}(?:-[a-z0-9]{2,4})?)?';
  const SERIES_PATH = new RegExp(`^${LOCALE_PREFIX}/series/[^/]+(?:/[^/]+)?/?$`, 'i');
  const WATCH_PATH = new RegExp(`^${LOCALE_PREFIX}/watch/[^/]+(?:/[^/]+)?/?$`, 'i');
  const CALENDAR_PATH = new RegExp(`^${LOCALE_PREFIX}/releasecalendar/?$`, 'i');

  // 'series' | 'watch' | 'calendar' | 'other' (the script is injected on every
  // crunchyroll.com page so it can follow in-site navigation, and stays idle on 'other').
  function currentPageKind() {
    const path = location.pathname;
    // Series URLs include both an ID and a human-readable slug.
    if (SERIES_PATH.test(path)) return 'series';
    if (WATCH_PATH.test(path)) return 'watch';
    if (CALENDAR_PATH.test(path)) return 'calendar';
    return 'other';
  }
  const isTitlePage = kind => kind === 'series' || kind === 'watch';

  function getStructuredSeriesTitle() {
    const kind = currentPageKind();
    if (!isTitlePage(kind)) return '';
    // JSON-LD and og:title prefix the series name with a localized "Watch"
    // ("Watch Show Name"). The series page's own heading holds the bare title,
    // so when the prefixed name ends with it, use the heading's text.
    const cleanSeriesName = name => {
      const raw = String(name || '').trim();
      const heading = document.querySelector('main h1, [role="main"] h1, #content h1, h1');
      const bare = (heading?.dataset?.crrcfOriginalPageTitle || heading?.textContent || '').trim();
      const rawKey = titleKey(raw), bareKey = titleKey(bare);
      if (kind === 'series' && bareKey && rawKey !== bareKey && rawKey.endsWith(` ${bareKey}`)) return bare;
      return raw.replace(/^Watch\s+/i, '').trim();
    };
    const readSeries = value => {
      if (!value || typeof value !== 'object') return '';
      const type = value['@type'];
      if ((type === 'TVSeries' || (Array.isArray(type) && type.includes('TVSeries'))) && value.name) {
        return cleanSeriesName(value.name);
      }
      if (value.partOfSeries?.name) return String(value.partOfSeries.name).trim();
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = readSeries(item);
          if (found) return found;
        }
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') {
          const found = readSeries(child);
          if (found) return found;
        }
      }
      return '';
    };

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const found = readSeries(JSON.parse(script.textContent || ''));
        if (found) return found;
      } catch (_) {}
    }

    if (kind === 'series') {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
      if (ogTitle) return cleanSeriesName(ogTitle);
    }

    // The watch page exposes the parent series URL even though its document
    // title describes the episode.
    const seriesUrl = document.querySelector('meta[property="video:series"]')?.content || '';
    if (seriesUrl) {
      try {
        const slug = new URL(seriesUrl, location.origin).pathname.split('/').filter(Boolean).at(-1);
        if (slug) return decodeURIComponent(slug).replace(/-/g, ' ').trim();
      } catch (_) {}
    }
    return '';
  }

  function findMetadataForTitle(title) {
    const key = titleKey(title);
    if (!key) return null;
    const direct = metadataByTitle.get(key);
    if (direct) return direct;
    for (const record of metadataByTitle.values()) {
      if (titleKey(record.crunchyrollTitle) === key) return record;
    }
    return null;
  }

  // Replace only text nodes. Assigning textContent destroys Crunchyroll's
  // nested typography and card markup.
  function replaceTitleTextPreservingMarkup(node, originalTitle, desiredTitle) {
    if (!node) return false;
    const currentKey = titleKey(node.textContent || '');
    const originalKey = titleKey(originalTitle);
    const desiredKey = titleKey(desiredTitle);
    // Crucial: do not rewrite text nodes when the desired title is already
    // displayed. Reassigning nodeValue can disturb native text selection and
    // needlessly retrigger the page MutationObserver.
    if (currentKey === desiredKey) return true;
    if (currentKey !== originalKey &&
        !node.dataset.crrcfOriginalPageTitle && !node.dataset.crrcfRecommendationOriginal) return false;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const nonEmpty = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) nonEmpty.push(walker.currentNode);
    if (!nonEmpty.length) { node.appendChild(document.createTextNode(desiredTitle)); return true; }
    const first = nonEmpty[0];
    const leading = first.nodeValue.match(/^\s*/)?.[0] || '';
    const trailing = first.nodeValue.match(/\s*$/)?.[0] || '';
    const nextFirstValue = `${leading}${desiredTitle}${trailing}`;
    if (first.nodeValue !== nextFirstValue) {
      ownTitleTextMutations.set(first, nextFirstValue);
      first.nodeValue = nextFirstValue;
    }
    for (const extra of nonEmpty.slice(1)) {
      if (extra.nodeValue !== '') {
        ownTitleTextMutations.set(extra, '');
        extra.nodeValue = '';
      }
    }
    return true;
  }

  function findPageShowTitles(seriesTitle) {
    const kind = currentPageKind();
    const wanted = titleKey(seriesTitle);
    const seriesHref = document.querySelector('meta[property="video:series"]')?.content
      || document.querySelector('link[rel="canonical"]')?.href || '';
    let seriesId = '';
    try { seriesId = new URL(seriesHref, location.origin).pathname.match(/\/series\/([^/]+)/)?.[1] || ''; } catch (_) {}

    const selector = [
      '[class*="playable-card__show-title"]',
      '[class*="playable-card-hover__secondary-title"]',
      '[data-t="series-title"] small',
      'a[data-t="show-title-link"] h4',
      '.current-media-parent-ref h4',
      'a[href*="/series/"]',
      'main h1', '[role="main"] h1', '#content h1', '#content h2',
      'h1', 'h2', '[role="heading"]', '[data-t*="title"]'
    ].join(',');
    const candidates = [];
    if (kind === 'watch' && seriesId) {
      candidates.push(...document.querySelectorAll(`a[href*="/series/${CSS.escape(seriesId)}"]`));
    }
    candidates.push(...document.querySelectorAll(selector));
    const matches = [...new Set(candidates)].filter(node => {
      if (!(node instanceof Element) || node.closest('#crrcf-panel, #crrcf-watch-reading-toggle, #crrcf-watch-reading-toggle-wrapper')) return false;
      const current = titleKey(node.textContent || '');
      const original = titleKey(node.dataset.crrcfOriginalPageTitle || '');
      return current === wanted || original === wanted;
    });

    // Prefer the actual title nodes, not their wrapping card links. Return all
    // matches: the same series title is rendered in base and hover card layers.
    const playable = matches.filter(node => node.matches(
      '[class*="playable-card__show-title"], [class*="playable-card-hover__secondary-title"], [data-t="series-title"] small'
    ));
    const watchSeriesTitles = matches.filter(node => node.matches(
      'a[data-t="show-title-link"] h4, .current-media-parent-ref h4'
    ));
    const headings = matches.filter(node => node.matches('h1,h2,[role="heading"]'));
    const preferred = kind === 'series'
      ? [...playable, ...headings]
      : [...watchSeriesTitles, ...headings, ...playable];
    const result = preferred.length ? preferred : matches;
    return [...new Set(result)].filter(node => {
      // Avoid replacing a parent and its nested dedicated title independently.
      return !result.some(other => other !== node && node.contains(other));
    });
  }

  function getSeriesRecommendationSection() {
    const heading = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
      .find(node => /^more like this$/i.test((node.textContent || '').trim()));
    if (!heading) return null;
    let current = heading;
    for (let depth = 0; current && depth < 8; depth++, current = current.parentElement) {
      const ids = new Set([...current.querySelectorAll('a[href*="/series/"]')]
        .map(a => a.getAttribute('href')?.match(/\/series\/([^/?#]+)/)?.[1]).filter(Boolean));
      if (ids.size >= 2) return current;
    }
    return heading.parentElement;
  }

  function collectSeriesRecommendations() {
    const section = getSeriesRecommendationSection();
    if (!section) return [];
    const unique = new Map();
    for (const link of section.querySelectorAll('a[href*="/series/"]')) {
      const id = link.getAttribute('href')?.match(/\/series\/([^/?#]+)/)?.[1];
      if (!id || link.closest('#crrcf-panel')) continue;
      const node = link.querySelector('[class*="playable-card__show-title"]') || link.querySelector('small') || link;
      if (!node.dataset.crrcfRecommendationOriginal) node.dataset.crrcfRecommendationOriginal = node.textContent.trim();
      const title = node.dataset.crrcfRecommendationOriginal;
      const key = titleKey(title);
      if (!key || !title) continue;
      if (!unique.has(key)) unique.set(key, { id, title, nodes: [] });
      unique.get(key).nodes.push(node);
    }
    return [...unique.values()];
  }

  let recommendationScanPromise = null;
  let recommendationScanAgain = false;
  async function scanSeriesRecommendations() {
    if (currentPageKind() !== 'series') return;
    if (recommendationScanPromise) { recommendationScanAgain = true; return recommendationScanPromise; }
    recommendationScanPromise = (async () => {
      for (const item of collectSeriesRecommendations()) {
        const key = titleKey(item.title);
        let record = findMetadataForTitle(item.title);
        // Only look titles up when the Romaji feature is on (nothing leaves the browser otherwise).
        if (!record && romajiEnabled() && !metadataAttempted.has(key)) {
          metadataAttempted.add(key);
          record = await lookupAniListMetadata(item.title);
        }
        const desired = romajiFor(record) || item.title;
        for (const node of item.nodes) {
          replaceTitleTextPreservingMarkup(node, item.title, desired);
          node.dataset.crrcfDisplayedRecommendationTitle = desired;
        }
      }
    })().finally(() => {
      recommendationScanPromise = null;
      if (recommendationScanAgain) { recommendationScanAgain = false; Promise.resolve().then(scanSeriesRecommendations); }
    });
    return recommendationScanPromise;
  }

  function applySeriesWatchTitle() {
    const kind = currentPageKind();
    if (!isTitlePage(kind)) return;
    if (kind !== 'watch') document.getElementById('crrcf-watch-reading-toggle-wrapper')?.remove();
    const seriesTitle = getStructuredSeriesTitle();
    if (!seriesTitle) return;
    const record = findMetadataForTitle(seriesTitle);
    const romaji = romajiFor(record);
    const nodes = findPageShowTitles(seriesTitle);
    if (!record || !romaji) {
      document.getElementById('crrcf-watch-reading-toggle-wrapper')?.remove();
      return;
    }
    if (!nodes.length) return;

    const identity = `${location.pathname}|${seriesTitle}`;
    for (const node of nodes) {
      if (node.dataset.crrcfPageIdentity !== identity) {
        node.dataset.crrcfPageIdentity = identity;
        node.dataset.crrcfOriginalPageTitle = seriesTitle;
        delete node.dataset.crrcfManualReading;
      } else if (!node.dataset.crrcfOriginalPageTitle) {
        node.dataset.crrcfOriginalPageTitle = seriesTitle;
      }
    }

    // The setting controls all series-page title instances. The watch-page
    // button is a local override and changes only the main show title.
    let showRomaji = true; // romajiFor() is only non-null when this show's country is selected
    const primaryNode = nodes.find(node => node.matches('h1,[role="heading"]')) || nodes[0];
    if (kind === 'watch' && primaryNode.dataset.crrcfManualReading) {
      showRomaji = primaryNode.dataset.crrcfManualReading === 'romaji';
    }
    const desiredTitle = showRomaji ? romaji : seriesTitle;
    for (const node of nodes) {
      const nodeShowRomaji = kind === 'watch' && node === primaryNode
        ? showRomaji
        : true;
      const displayedTitle = nodeShowRomaji ? romaji : seriesTitle;
      replaceTitleTextPreservingMarkup(node, seriesTitle, displayedTitle);
      node.dataset.crrcfDisplayedTitle = displayedTitle;
      node.dataset.crrcfAppliedRomaji = nodeShowRomaji ? '1' : '0';
    }

    if (kind === 'watch') {
      let toggleWrapper = document.getElementById('crrcf-watch-reading-toggle-wrapper');
      let toggle = document.getElementById('crrcf-watch-reading-toggle');
      if (!toggleWrapper) {
        toggleWrapper = document.createElement('div');
        toggleWrapper.id = 'crrcf-watch-reading-toggle-wrapper';
        toggleWrapper.className = 'crrcf-watch-reading-toggle-wrapper';
      }
      if (!toggle) {
        toggle = document.createElement('button');
        toggle.id = 'crrcf-watch-reading-toggle';
        toggle.type = 'button';
        toggle.className = 'crrcf-watch-reading-toggle';
        toggle.textContent = 'あ';
        toggle.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          const target = toggle._crrcfTitleNode;
          if (!target?.isConnected) return;
          target.dataset.crrcfManualReading = target.dataset.crrcfAppliedRomaji === '1' ? 'original' : 'romaji';
          applySeriesWatchTitle();
        });
      }
      toggle._crrcfTitleNode = primaryNode;
      if (toggle.parentElement !== toggleWrapper) toggleWrapper.appendChild(toggle);
      const titleLink = primaryNode.closest('a[data-t="show-title-link"]');
      // Experimental placement: restore the previous layout by placing the
      // toggle inside .current-media-parent-ref, immediately before the title link.
      const toggleAnchor = titleLink || primaryNode;
      const toggleParent = toggleAnchor.parentElement;
      if (toggleParent && (toggleWrapper.parentElement !== toggleParent || toggleWrapper.nextSibling !== toggleAnchor)) {
        toggleParent.insertBefore(toggleWrapper, toggleAnchor);
      }
      toggle.setAttribute('aria-pressed', showRomaji ? 'true' : 'false');
      toggle.title = showRomaji
        ? 'Show original title (does not change settings)'
        : 'Show romaji title (does not change settings)';
    }
  }

  // Title mode: swaps series/episode titles on /series and /watch pages.
  let titleRun = () => {};
  function startTitleMode() {
    if (titleObserver) { titleRun(); return; }
    let scheduled = false;
    const pageTitleSelector = [
      'a[data-t="show-title-link"] h4', '.current-media-parent-ref h4',
      'main h1', '[role="main"] h1', '#content h1', '#content h2',
      'h1', 'h2', '[role="heading"]',
      '[class*="playable-card__show-title"]',
      '[class*="playable-card-hover__secondary-title"]',
      '[data-t="series-title"] small'
    ].join(',');
    const extensionOwnedSelector = '#crrcf-panel, #crrcf-gear, #crrcf-watch-reading-toggle-wrapper, #crrcf-watch-reading-toggle';

    const asElement = node => node instanceof Element ? node : node?.parentElement || null;
    const isExtensionOwned = node => {
      const element = asElement(node);
      return Boolean(element && (element.matches(extensionOwnedSelector) || element.closest(extensionOwnedSelector)));
    };
    const needsRefresh = element => {
      if (!(element instanceof Element)) return false;
      const expected = element.dataset.crrcfDisplayedTitle || element.dataset.crrcfDisplayedRecommendationTitle;
      return !expected || titleKey(element.textContent || '') !== titleKey(expected);
    };
    const containsTitleNeedingRefresh = node => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE || isExtensionOwned(node)) return false;
      const element = node;
      if (element.matches(pageTitleSelector) && needsRefresh(element)) return true;
      return [...element.querySelectorAll(pageTitleSelector)].some(needsRefresh);
    };
    // The watch page can finish rendering its title metadata after the content
    // script has initialized. Observe only the metadata used by
    // getStructuredSeriesTitle(), in addition to the visible title nodes.
    const isSeriesMetadataElement = node => {
      const element = asElement(node);
      return Boolean(element && (
        element.matches('meta[property="video:series"], script[type="application/ld+json"]') ||
        element.closest('script[type="application/ld+json"]')
      ));
    };
    const containsSeriesMetadata = node => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      return isSeriesMetadataElement(node) ||
        Boolean(node.querySelector?.('meta[property="video:series"], script[type="application/ld+json"]'));
    };

    const mutationIsRelevant = mutation => {
      if (isExtensionOwned(mutation.target)) return false;

      // JSON-LD may be inserted first and populated in a later mutation; the
      // video:series meta tag may also receive its content attribute later.
      if (mutation.type === 'attributes') {
        const target = asElement(mutation.target);
        if (target?.matches('meta[property="video:series"]') &&
            (mutation.attributeName === 'content' || mutation.attributeName === 'property')) return true;
        if (target?.matches('script[type="application/ld+json"]') && mutation.attributeName === 'type') return true;
      }
      if (mutation.type === 'characterData') {
        const ownExpectedValue = ownTitleTextMutations.get(mutation.target);
        if (ownExpectedValue !== undefined) {
          ownTitleTextMutations.delete?.(mutation.target);
          if (mutation.target.nodeValue === ownExpectedValue) return false;
        }
        if (isSeriesMetadataElement(mutation.target)) return true;
        const element = asElement(mutation.target);
        const title = element?.matches(pageTitleSelector) ? element : element?.closest(pageTitleSelector);
        return Boolean(title && needsRefresh(title));
      }

      const target = asElement(mutation.target);
      if (isSeriesMetadataElement(target)) return true;
      if (target?.matches(pageTitleSelector) && needsRefresh(target)) return true;
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return changedNodes.some(node => containsSeriesMetadata(node) || containsTitleNeedingRefresh(node));
    };

    const run = () => {
      scheduled = false;
      applySeriesWatchTitle();
      if (currentPageKind() === 'series') scanSeriesRecommendations();
    };
    titleRun = run;
    titleObserver = new MutationObserver(mutations => {
      // Ignore unrelated page churn and our own button/panel changes. Only
      // re-run when a relevant title is inserted, replaced, or changes text.
      if (!mutations.some(mutationIsRelevant) || scheduled) return;
      scheduled = true;
      requestAnimationFrame(run);
    });
    titleObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['content', 'property', 'type'] });
    run();
  }

  function stopTitleMode() {
    titleObserver?.disconnect();
    titleObserver = null;
    titleRun = () => {};
    document.getElementById('crrcf-watch-reading-toggle-wrapper')?.remove();
  }

  // Calendar mode: filters, layout and settings panel on the release calendar.
  const onCalendarResize = () => {
    applyCalendarSize();
    positionPanel(document.getElementById('crrcf-panel'), document.getElementById('crrcf-gear'));
  };

  // Crunchyroll can update the week in place, without replacing the whole calendar.
  // Re-apply after the navigation action and once more after React finishes rendering.
  const onCalendarClick = event => {
    if (!event.target.closest?.('[data-t="previous-week"], [data-t="next-week"]')) return;
    metadataAttempted.clear();
    setTimeout(() => {
      queueApply();
      scanAniListMetadata().then(() => { if (romajiEnabled()) applyRomajiFromCache(); queueApply(); });
      if (romajiEnabled()) applyRomajiFromCache();
    }, 350);
    setTimeout(() => {
      queueApply();
      if (romajiEnabled()) applyRomajiFromCache();
    }, 900);
  };

  // After in-site navigation the site's own 24-hour switch may render a moment
  // later than this script runs, so wait for it (up to ~10 s) before syncing it once.
  function syncNativeTime(attempt = 0) {
    if (activeKind !== 'calendar') return;
    if (document.querySelector('input[name="release-calendar-time-format"]')) setNativeTime(settings.time24h);
    else if (attempt < 20) setTimeout(() => syncNativeTime(attempt + 1), 500);
  }

  function startCalendarMode() {
    if (calendarObserver) return;
    attachGear();
    window.addEventListener('resize', onCalendarResize);
    document.addEventListener('click', onCalendarClick, true);
    document.documentElement.classList.toggle('crrcf-align-cards', settings.alignCards);
    document.documentElement.classList.toggle('crrcf-truncate-titles', settings.truncateTitles);
    applyCalendarSize();
    syncNativeTime();
    queueApply();
    scanAniListMetadata().then(() => { if (romajiEnabled()) applyRomajiFromCache(); queueApply(); });
    if (romajiEnabled()) applyRomajiFromCache();
    calendarObserver = new MutationObserver(mutations => {
      if (document.querySelector('.erc-release-calendar')) applyCalendarSize();
      // Ignore our own settings panel, gear, and counter text to prevent observer loops.
      const relevant = mutations.some(mutation => {
        if (mutation.type === 'characterData') {
          const parent = mutation.target.parentElement;
          return Boolean(parent?.closest("[data-t='release-calendar-card'], [data-t='release-cell'], [data-t='day-column']"))
            && !parent?.closest('#crrcf-panel, #crrcf-gear, .crrcf-hidden-count');
        }
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          return target instanceof Element && !target.closest('#crrcf-panel, #crrcf-gear, .crrcf-hidden-count');
        }
        const changed = [...mutation.addedNodes, ...mutation.removedNodes];
        return changed.some(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return false;
          if (node.matches?.('#crrcf-panel, #crrcf-gear, .crrcf-hidden-count')) return false;
          if (node.closest?.('#crrcf-panel, #crrcf-gear, .crrcf-hidden-count')) return false;
          return true;
        });
      });
      if (relevant) {
        attachGear();
        if (!document.getElementById('crrcf-panel')?.hidden) requestAnimationFrame(() => positionPanel(document.getElementById('crrcf-panel'), document.getElementById('crrcf-gear')));
        queueApply();
        scanAniListMetadata().then(() => { if (romajiEnabled()) applyRomajiFromCache(); queueApply(); });
        if (romajiEnabled()) requestAnimationFrame(() => applyRomajiFromCache());
      }
    });
    calendarObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'data-t'] });
  }

  function stopCalendarMode() {
    calendarObserver?.disconnect();
    calendarObserver = null;
    window.removeEventListener('resize', onCalendarResize);
    document.removeEventListener('click', onCalendarClick, true);
    restoreTimezoneNote();
    for (const id of ['crrcf-gear', 'crrcf-panel', 'crrcf-anilist-progress']) document.getElementById(id)?.remove();
    const root = document.documentElement;
    root.classList.remove('crrcf-align-cards', 'crrcf-truncate-titles', 'crrcf-hide-premiere', 'crrcf-wide-calendar');
    root.style.removeProperty('--crrcf-calendar-inset');
  }

  // Crunchyroll is a single-page app: moving between the calendar, a series and an
  // episode does not reload the page, so the content script never starts again.
  // The router re-checks the URL whenever it may have changed and switches the
  // matching mode on or off. It stays idle on every other crunchyroll.com page.
  let lastHref = '';
  async function route() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    const kind = currentPageKind();
    if (kind !== 'other') await ensureLoaded();
    if (location.href !== lastHref) return; // a newer route() call handles the newer URL
    if (kind !== activeKind) {
      if (activeKind === 'calendar') stopCalendarMode();
      if (isTitlePage(activeKind) && !isTitlePage(kind)) stopTitleMode();
      activeKind = kind;
    }
    if (kind === 'calendar') startCalendarMode();
    else if (isTitlePage(kind)) startTitleMode(); // already running: refreshes the titles
  }

  function startRouter() {
    const schedule = () => setTimeout(route, 0);
    // Immediate reaction where the Navigation API exists (pushState, replaceState, back/forward)…
    window.navigation?.addEventListener?.('currententrychange', schedule);
    window.addEventListener('popstate', schedule);
    // …plus a cheap URL check (one string comparison per tick). Firefox has no
    // Navigation API (and content scripts cannot see the page's pushState), so
    // there it is the main trigger and runs 4x more often.
    setInterval(route, window.navigation ? 1000 : 250);
    route();
  }

  // Settings and the AniList cache are read the first time a supported page is
  // opened, not on every crunchyroll.com page.
  function normalizeSettings(saved) {
    const next = { ...DEFAULTS };
    if (saved && typeof saved === 'object') {
      // Copy known keys only: this also drops keys left behind by older builds.
      for (const key of Object.keys(DEFAULTS)) if (saved[key] !== undefined) next[key] = saved[key];
    }
    if (!Array.isArray(next.selectedLanguages)) next.selectedLanguages = [...DEFAULTS.selectedLanguages];
    next.selectedLanguages = next.selectedLanguages.filter(code => LANGUAGES.some(x => x[0] === code));
    const level = Math.round(Number(next.calendarWidthLevel));
    next.calendarWidthLevel = Number.isFinite(level)
      ? Math.max(0, Math.min(WIDTH_LEVELS.length - 1, level))
      : DEFAULTS.calendarWidthLevel;
    // v1 -> v2: the single "Romaji titles" switch became a list of countries.
    if (saved && !Array.isArray(saved.romanizeCountries) && saved.showRomajiTitles === true) {
      next.romanizeCountries = [...TITLE_COUNTRIES.map(([code]) => code), OTHER_COUNTRY];
    }
    if (!Array.isArray(next.romanizeCountries)) next.romanizeCountries = [];
    const validCountries = [...TITLE_COUNTRIES.map(([code]) => code), OTHER_COUNTRY];
    next.romanizeCountries = [...new Set(next.romanizeCountries.filter(code => validCountries.includes(code)))];
    next.schemaVersion = SCHEMA_VERSION;
    return next;
  }

  let loadPromise = null;
  function ensureLoaded() {
    loadPromise ||= (async () => {
      const saved = await loadSettings();
      await loadMetadataCache();
      settings = normalizeSettings(saved);
      // Add future migrations in normalizeSettings(), keyed on saved.schemaVersion.
      if (!saved || saved.schemaVersion !== SCHEMA_VERSION) saveSettings();
    })();
    return loadPromise;
  }

  startRouter();
})();
