# Chrome Web Store listing – Better Roll

Copy these into the Developer Dashboard. Everything here matches the 1.0.0 code; if behaviour changes, update this file too.

## Store listing tab

**Name:** Better Roll

**Summary (max 132 characters):**

> Filter Crunchyroll's Release Calendar by audio language, tidy its layout and optionally show romaji titles. Unofficial.

**Category:** Entertainment

**Detailed description:**

> Better Roll makes Crunchyroll's Release Calendar easier to use.
>
> • Audio-language filter – only see releases with the dubs you care about (Japanese by default).
> • Hidden counters – every day shows how many cards your filters are hiding.
> • Always show original-audio releases (optional) – keep a release visible when its likely original-language audio is available.
> • Romaji titles (optional) – show romaji titles on the calendar, series pages and episode pages.
> • Layout tweaks – align cards, hide PREMIERE labels, clamp long titles and widen the calendar.
> • 24-hour time toggle.
>
> Privacy: no accounts, no analytics, no servers. Settings stay in your browser. The two optional AniList-based features send show titles to AniList's public API and are off by default.
>
> Better Roll is an unofficial, community project. It is not affiliated with, endorsed by, or sponsored by Crunchyroll or AniList.

**Language:** English

**Screenshots (1280×800 or 640×400):** calendar before/after filtering; the settings panel with Audio Options open; Style Options open; calendar size comparison; an episode page with the あ button. Use a Crunchyroll account with nothing personal visible.

**Small promo tile (440×280):** optional; use the Better Roll icon, not Crunchyroll's logo.

## Privacy tab

**Single purpose:**

> Improve the usability of the Crunchyroll Release Calendar by filtering releases by audio language, adjusting its layout, and optionally showing romaji titles.

**Permission justifications:**

- `storage` – saves the user's settings and a local cache of AniList lookup results.
- Host permission `https://www.crunchyroll.com/*` – the extension reads and restyles the Release Calendar, series pages and episode pages. It runs on every crunchyroll.com page only so it can follow in-site navigation, and does nothing on pages other than those three.
- Host permission `https://graphql.anilist.co/*` – looks up show titles on AniList's public API for the optional "Romaji titles" and "Always show original-audio releases" features.

**Remote code:** No. All code is in the package.

**Data usage disclosure** (what the dashboard asks):

- Website content – **yes, transmitted**: show title text is sent to AniList, only when one of the two optional features is on.
- Personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity – **no**.
- Certify that: data is not sold to third parties; not used or transferred for purposes unrelated to the item's single purpose; not used to determine creditworthiness or for lending.

**Privacy policy URL:** `https://github.com/EndsLover/better_roll/blob/main/PRIVACY.md`

## Before submitting

- Zip only the extension files: `manifest.json`, `content.js`, `content.css` and `icons/`. Leave out `.git`, `docs/` and the Markdown files.
- Confirm the version in `manifest.json` is higher than any version you uploaded before.
- Keep the "not affiliated" sentence in the description and avoid Crunchyroll's logo or mascots in the icon, screenshots and promo images.
