# VicElect

VicElect tracks the 2026 Victorian Legislative Assembly election across all 88 electorates. The overview shows the race to 45 seats, the electorate map, and new releases from the Victorian Electoral Commission (VEC).

## Run locally

Use Node.js 24 or later.

```sh
npm ci
npm run dev
```

Open the Vite URL printed in the terminal. The local app starts with the official nominations and previous results. The results feed remains idle until configured.

## Owner control panel

Copy `.env.example` to `.env`, set `ADMIN_PASSWORD` to a strong passphrase of at least 16 characters, and restart the server. Sign in at `/control`.

- Publish or withdraw a VicElect seat call. Calls update the public majority count immediately on the next refresh. An official VEC declaration takes precedence.
- Select two candidates for the electorate’s preferred count or revert to the VEC’s pairing. When an alternative pairing has no published figures, the electorate page shows it as awaiting a VEC count. First preferences alone cannot determine those figures.
- Where the published comparison is Labor versus Liberal or Nationals, the electorate page shows the change in Labor’s percentage-point share against the VEC’s 2022 two-party-preferred result. This comparison is unavailable in Narracan, where the 2022 contest was postponed.

## Connect the official feed

Request access and accept the VEC terms through the [2026 results data feed page](https://www.vec.vic.gov.au/about-us/media/2026-results-data-feed). The VEC provides a shared access token and separate connection instructions to approved users. The importer uses the **Verbose Lower House V2** ZIP snapshots.

Set one of these in the server’s `.env`.

| Setting | Input |
| --- | --- |
| `VEC_FEED_DIRECTORY` | A directory written by your approved downloader. Stage downloads under a temporary name and rename them after each ZIP is complete. Retain the original `State2026mediafileverboselhv2_YYYYMMDD_HHMMSS.zip` filenames. |
| `VEC_FEED_LIST_URL` | An HTTPS listing with same-origin download links or an Azure Blob XML listing. If authorization uses a supported bearer token, set `VEC_FEED_BEARER_TOKEN` on the server as well. |
| `VEC_FEED_SNAPSHOT_URL` | A stable HTTPS endpoint serving the newest Verbose Lower House ZIP. Useful if the approved download method needs a separate bridge. |

The server checks for a newer snapshot every minute. The browser refreshes public counts every 15 seconds. The VEC publishes roughly every five minutes during election weekend. The importer rejects test events and pre-close snapshots. It keeps the latest accepted numbers available during interruptions.

For the [VEC trial on Wednesday 25 November](https://www.vec.vic.gov.au/about-us/media/2026-results-data-feed), use an isolated test database. The public importer rejects trial archives.

## Run the production build

```sh
npm run build
npm start
```

Use a persistent directory for `DATA_DIRECTORY` (default `.data`) to retain the SQLite database, including seat calls, candidate pairs, and results history. The service defaults to `127.0.0.1:8787`. For a public deployment, serve it behind HTTPS and set `PUBLIC_ORIGIN` to the public HTTPS origin so the control panel issues secure cookies.

## Data sources

- State of Victoria (Victorian Electoral Commission). [2026 candidates](https://www.vec.vic.gov.au/voting/2026-state-election/find-candidates), [2022 results and two-party-preferred figures](https://www.vec.vic.gov.au/results/state-election-results/2022-state-election-results), and [Narracan supplementary results](https://www.vec.vic.gov.au/results/state-election-results/state-by-elections-timeline/narracan-district-supplementary-election-results). The 2022 map includes the Narracan supplementary winner. Candidate contact information is omitted.
- State of Victoria. [Vicmap Admin electoral boundaries](https://discover.data.vic.gov.au/dataset/vicmap-admin-state-assembly-polygon-2022), simplified for the interactive map.
