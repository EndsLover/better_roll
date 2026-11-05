# Changelog

## 1.0.0

First public release, renamed to **Better Roll**.

### Changed
- **Always show original-audio releases** (formerly "Force original audio") is now **off by default**. AniList is only contacted while it or **Romaji titles** is on.
- AniList lookups search **anime only** (the extra manga request for unmatched titles is gone).
- AniList requests are spaced 2.1 s apart. On HTTP 429 all lookups pause and then retry the same title, for the `Retry-After` time when the browser exposes it and otherwise 60 s, until it succeeds.
- Audio languages are read from the card's `aria-label` instead of matching localized label text, so the filter works with any Crunchyroll interface language.
- All interface text is in English.
- Settings are versioned with a single `schemaVersion`; migrations for pre-release builds were removed.
- In browsers without the Navigation API (Firefox), the URL check runs every 250 ms instead of every second.
- Replaced hashed Crunchyroll class names in selectors with stable ones (`.erc-release-calendar`, `data-t`).
- Cleaner manifest description, and a real Firefox add-on ID.

### Fixed
- Romaji titles now work for shows from any country. Before, the romaji title was only saved for Japanese shows, so Chinese and Korean shows (for example *Paw & Palaces*) were found on AniList but never renamed; for those, AniList's "romaji" is the pinyin/romanisation. Older cache entries are looked up again automatically.
- Navigating between the calendar, series pages and episode pages without reloading now switches features on and off correctly; previously the page type was decided once at load.
- Locale-prefixed URLs (`/pt-br/…`, `/de/…`, etc.) are supported on the calendar, series and episode pages.
- Series pages in other languages: the localized "Watch" prefix in the page metadata is no longer treated as part of the show title.

### Added
- User guide in the README, `PRIVACY.md`, and Chrome Web Store listing text in `docs/store-listing.md`.

## Pre-release test builds (0.1 – 0.2.11)

Internal builds published as "Crunchyroll Release Calendar Filter (Test)". Highlights:

- Audio-language filter with an "Others" category, hidden-card counters, card alignment, hidden `PREMIERE` labels, and clamped titles.
- 24-hour toggle replaced in place by the settings gear.
- AniList integration (country of origin and romaji titles), with a persistent local cache, an editable "memory", and a log viewer.
- Calendar size levels (Original to Full).
- Romaji titles on series and episode pages, with an **あ** toggle on episode pages and observer fixes that keep native text selection working.
