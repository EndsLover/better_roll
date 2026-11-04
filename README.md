# Crunchyroll Release Calendar Filter — 0.2.11

## 0.2.11 changes
- The series/watch-page observer now detects late insertion or updates of the JSON-LD `TVSeries` data and `video:series` metadata, then retries title application when the required metadata becomes available.
- The observer also watches the relevant metadata attributes while continuing to ignore unrelated page mutations and extension-owned UI changes.

## 0.2.9 changes
- The series/watch-page observer now filters mutations and ignores extension-owned UI changes and unrelated page churn.
- Title replacement is a no-op when the requested title is already displayed, avoiding unnecessary text-node rewrites that can interfere with native selection.
- Recommendation titles record their displayed value so the observer can detect genuine Crunchyroll re-renders without repeatedly rewriting them.

# Crunchyroll Release Calendar Filter (Test) v0.2.2

Experimental extension for `https://www.crunchyroll.com/releasecalendar`.

## Features
- Audio-language filters with a collapsible list.
- `Others` (`??`) behaves like a normal selectable language category and includes cards with unrecognized audio-language codes when selected.
- Hidden-card counters, including zero counts.
- Native 24-hour toggle replaced in-place by the settings gear; the 24-hour preference remains available in the panel.
- Optional card alignment and hiding of `PREMIERE` labels.
- **Force original audio** uses AniList `countryOfOrigin` metadata to keep a card visible when its likely original-language track is available, even if that language is not selected in the audio filters. Supported mappings are `JP` → `JA`, `CN` → `ZH`, and `KR` → `KO`. This is a country-of-origin heuristic, not definitive proof of the original audio language.
- AniList metadata is looked up automatically in the background for calendar titles not already cached. Successful records are saved persistently in `chrome.storage.local` / `browser.storage.local` and contain the Crunchyroll title, romaji title (Japanese-origin titles only), country of origin, AniList ID, and AniList media type.
- **Romaji titles** reads the saved metadata cache. It does not need a new AniList request for titles already found. Exact title/synonym matches are required; for upcoming adaptations absent from the ANIME catalog, the lookup tries an exact MANGA match.
- AniList requests are serialized and spaced apart. HTTP 429 responses receive up to three retries with progressively longer waits. Failed lookups are not persisted and can be retried when the calendar week changes.
- Settings panel follows the gear's document position, uses a dark scrollbar, and stays below the Crunchyroll header.
- **Calendar size** has five draggable levels: Original, 20% borders, 10% borders, 5% borders, and Full. The border levels expand to the browser width while retaining the specified symmetric side gutters.
- Audio filters and Force original audio are grouped under **Audio Options**. Presentation toggles, including Limit long titles, are grouped under **Style Options**. By default all language filters and Others are unselected, while Force original audio, hidden counters, card alignment, hiding PREMIERE labels, and Limit long titles are enabled.
- The retry icon beside Romaji titles retries AniList lookups for titles that do not yet have a saved match. The memory controls use pencil, trash, and logs icons. The logs viewer shows only recent runtime errors and AniList not-found results in memory; logs are not persisted.
- **Edit Memory** lets users edit the saved AniList metadata as JSON; **Reset Memory** clears that metadata cache.
- **Limit long titles** is grouped inside Style Options and uses visual line clamping rather than permanently changing title text. After romaji titles are applied, active alignment and title clamping are reapplied.

## Original-audio limitations
AniList's `countryOfOrigin` is used as a practical heuristic. Only Japan, China, and South Korea are currently mapped to Crunchyroll audio codes. If the country is unsupported, metadata is missing, or the expected audio code is not present on the card, the extension does not infer or hide an audio track based on that metadata.

## Installation
1. Extract the ZIP.
2. Chrome/Edge: open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose this folder.
3. Firefox: open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose `manifest.json`.
4. Open or refresh the Crunchyroll Release Calendar page.


## v0.2.0
- Added an AniList activity spinner beside the settings gear.
- Reapply filters and title layout after each AniList response.
- Recalculate card alignment when title truncation changes.
- Updated memory action order, orange active states, and save/cancel icons.
- Calendar size now responds to clicks rather than drag interactions.
- Clear transient panel messages when closing or reopening settings.
- Restored the divider between Style Options and Calendar size.


## v0.2.0 isolated test build
- Based on v0.1.16 and includes only the previously requested UI/layout corrections 1–9.
- Moved AniList retry from the Romaji titles row into the centered bottom action row, immediately before Edit Memory.
- Added matching outline SVG icons for Logs, Retry, Edit, Reset, Save, and Cancel.
- Added an explicit divider between Style Options and Calendar size.
- Calendar size defaults to 10% borders (one-time settings migration).
- Reapplies card alignment when Hide PREMIERE labels changes.
- Places the AniList activity indicator immediately before the gear.
- Deliberately does not include the later Japanese-audio default, extended 429 cooldown/retry behavior, or delayed gear initialization.


## v0.2.0

- AniList search terms now have diacritics removed before the GraphQL request (for example, `Fiancé` becomes `Fiance`). Original titles remain unchanged for display, cache keys, and result matching.
- Removed the one-off AniList ID lookup for a specific anime; title lookup is now generic.

## Version 0.2.2: audio label fix
- Detects localized plain-text labels such as `Idiomas de áudio: AR` / `Idiomas de áudio: FR` in release cards even without `data-t=audio-languages` elements.
- Explicit release-language labels take precedence over other card metadata. Cards with genuinely missing language metadata continue to use the existing fallback.


## Version 0.2.2: cached romaji titles on series and watch pages
- The content script now also runs on `/series/*` and `/watch/*`.
- On those pages, the extension only reads the existing local AniList metadata cache. When **Romaji titles** is enabled, it replaces the show title with its saved romaji title when a matching cache entry exists.
- On `/watch/*`, a small `あ` button appears immediately to the left of the show title when a cached romaji title exists. It switches between the original and romaji reading for consultation only and does not modify the saved setting.
- Calendar filtering, AniList discovery, and calendar layout processing remain exclusive to the release calendar.


## 0.2.4
- Replace every matching series title instance, including base and hover card layers.
- Preserve the site's nested title markup and styling.
- Restore text selection/copy on watch-page show titles.


### 0.2.9
- Prevents the watch/series title observer from reacting to text-node mutations written by the extension itself.
- Avoids redundant text-node writes, including already-empty nested text nodes.
- Moves the watch reading toggle outside `.current-media-parent-ref`, immediately before the title container, so it no longer interferes with title text selection.


## Experimental 0.2.11 placement test

This build restores the previous toggle placement inside `.current-media-parent-ref`, immediately before the show-title link. All delayed metadata detection fixes from 0.2.10 are retained. This is an experimental layout test; text-selection behavior should be checked on the watch page.
