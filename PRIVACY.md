# Better Roll – Privacy Policy

_Last updated: 2026-11-03_

Better Roll is an unofficial browser extension for crunchyroll.com. This page explains what it does with data.

## Summary

- Better Roll has **no servers, no accounts and no analytics**, and it does not sell or share your data.
- Your settings and saved lookup results are stored **only in your browser**.
- Two optional features, **Title Options** (romanized titles, when at least one country is ticked) and **Always show original-audio releases**, send show titles to **AniList**. Both are **off by default**.

## What is stored on your device

Better Roll uses the browser's local extension storage (`storage` permission) to keep:

- your settings (selected languages, display options, calendar size);
- a cache of AniList results: the Crunchyroll show title, its romaji title, country of origin, AniList ID and media type.

This data never leaves your device through Better Roll. It is not synced to your account. You can clear the cache with **Reset Memory** in the settings panel, and uninstalling the extension removes everything.

## What is sent over the network

Only when at least one country is ticked in **Title Options** or **Always show original-audio releases** is switched on, Better Roll looks up show titles it sees on crunchyroll.com (release calendar titles, and recommendation titles on series pages) on AniList's public API at `https://graphql.anilist.co`.

- What is sent: the show title text, as a search query.
- What is not sent: your Crunchyroll account details, cookies, watch history or any other personal information. Requests carry no credentials.
- Like any web request, AniList can see your IP address and that the request was made from a page on crunchyroll.com. AniList handles that information under its own terms and privacy policy.

With both options off, Better Roll makes no requests of its own.

## Page access

Better Roll runs on crunchyroll.com pages to read the release calendar, series and episode pages (titles and audio-language labels) and adjust how they are displayed. It processes that page content locally, in your browser.

## Other points

- No remote code is loaded or executed.
- No advertising, profiling or analytics.
- If this policy changes, the updated version will be published in this repository.

## Contact

Questions or concerns: open an issue at <https://github.com/EndsLover/better_roll/issues>.

Better Roll is not affiliated with, endorsed by, or sponsored by Crunchyroll or AniList.
