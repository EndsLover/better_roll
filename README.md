# Better Roll

A browser extension that makes Crunchyroll's **Release Calendar** easier to use: filter releases by audio language, tidy the layout, and optionally show romanized titles.

> Better Roll is an unofficial, community project. It is not affiliated with, endorsed by, or sponsored by Crunchyroll or AniList.

## Features

- **Audio-language filter** – show only the releases that have the dubs you care about (Japanese by default).
- **Hidden counters** – each day shows how many cards your filters are hiding, so nothing disappears silently.
- **Always show original-audio releases** *(optional)* – keeps a release visible when its likely original-language track is available, even if that language is not selected.
- **Romanized titles** *(optional)* – for the countries you choose (Japan, China, Korea, others), replaces the global title with its romanized title (romaji, pinyin or Korean romanization) on the calendar, series pages and episode pages.
- **Layout tweaks** – align cards, hide `PREMIERE` labels, clamp long titles to two lines, and widen the calendar.
- **24-hour time** – a toggle for the calendar's time format.

## Install

**From the store:** Chrome Web Store link coming soon.

**From source (Chrome / Edge):**

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the repository folder.
4. Open the [Release Calendar](https://www.crunchyroll.com/releasecalendar).

**From source (Firefox):** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and choose `manifest.json`.

## User guide

Open the Release Calendar and click the orange **gear** at the top right, in the spot where Crunchyroll's own 24-hour switch used to be. The **Display Settings** panel has three collapsible sections and a few controls below them.

### Audio Options

- **Language chips** – under "Show releases with these audio languages", tick the audio languages you want to see. A release is shown when it has at least one of the selected languages. **All** and **None** select or clear every chip.
- **Others (`??`)** – also shows releases whose audio language Better Roll does not recognise.
- **Always show original-audio releases** – uses AniList to find each show's country of origin and keeps the release visible if its original audio is available (Japan → `JA`, China → `ZH`, South Korea → `KO`). This is a heuristic, not proof of the original audio track. Off by default.

Releases without readable language information are always shown, so a filter never hides something just because the page could not be parsed.

### Title Options

Under "Show original (romanized) titles of shows made in:", tick the countries whose shows should be shown with their romanized title instead of Crunchyroll's global (usually English) title. **All** and **None** select or clear every box. Nothing is ticked by default, so you see the global titles.

| Box | Shows made in | Romanized title is |
| --- | --- | --- |
| Japan | Japan | romaji |
| China | China | pinyin |
| Korea | South Korea | Korean romanization |
| Others | any other country | whatever AniList lists as romaji |

- A show is only romanized if it matches an AniList entry (see Troubleshooting). Unmatched titles keep the global title.
- To know a show's country, Better Roll looks its title up on AniList as soon as at least one box is ticked, including for shows from countries you did not tick. The result is saved, so each title is looked up once.
- **Limit long titles** (clamps titles to two lines, on by default) also lives here.

### Style Options

| Setting | What it does | Default |
| --- | --- | --- |
| Show hidden counters | Shows "N cards hidden" under each day | On |
| Align cards | Gives cards in the same row the same height | On |
| Hide PREMIERE labels | Hides the `PREMIERE` tag on cards | On |
| 24-hour time | Switches the calendar's time format | Off |

### Calendar size

The slider has five steps: **Original**, **20% borders**, **10% borders**, **5% borders** and **Full**. Click the step you want. The default is 10% borders.

### Buttons at the bottom

| Icon | Name | What it does |
| --- | --- | --- |
| List | View recent logs | Shows the last two minutes of errors and AniList "not found" results (kept in memory only) |
| ↻ | Retry | Looks up titles that have no saved AniList match again |
| Pencil | Edit Memory | Edit the saved AniList data as JSON |
| Trash | Reset Memory | Deletes all saved AniList data |

### Series and episode pages

For shows from a ticked country, the show title on `/series/…` and `/watch/…` pages is replaced by its romanized title when Better Roll already has a match saved. On episode pages a small **あ** button appears next to the show title to flip between the global and romanized title for that page; it does not change your settings, and it only appears for shows from a ticked country.

### Troubleshooting

- **A release is missing.** Check the "N cards hidden" counter for that day, then open **Audio Options** and select more languages (or **Others**).
- **Romanized titles do not appear.** Tick the show's country in **Title Options**, wait for the spinner next to the gear to stop, and press ↻ to retry unmatched titles. Only titles that match an AniList entry exactly (title or synonym) can be converted.
- **The first load is slow.** AniList limits how fast titles can be looked up, so Better Roll sends one request every ~2 seconds and waits when AniList asks it to. Results are saved, so later visits are instant.
- **The page looks broken after a Crunchyroll update.** Please [open an issue](https://github.com/EndsLover/better_roll/issues).

## Privacy

Better Roll has no servers, accounts or analytics. Settings and saved AniList data stay in your browser. Only the two AniList-based options (any ticked box in **Title Options** and **Always show original-audio releases**) contact a third party, and both are off by default. See [PRIVACY.md](PRIVACY.md).

## Known limitations

- Original audio detection only covers Japan, China and South Korea.
- AniList matching is by exact title or synonym, and searches anime only.
- On series pages, recommendation titles are only recognised when the section heading is in English.

## Development

There is no build step: `manifest.json`, `content.js` and `content.css` are the extension. Crunchyroll's markup changes often, so prefer `data-t` attributes and stable `erc-` classes over hashed class names in selectors. See [CHANGELOG.md](CHANGELOG.md) for release notes and [docs/store-listing.md](docs/store-listing.md) for the Chrome Web Store listing text.
