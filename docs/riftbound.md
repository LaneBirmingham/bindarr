# Riftbound support and verification

Bindarr now supports Riftbound through the same provider, card cache, collection,
binder/box, deck, dashboard, import/export and scan catalogue paths as its other
games. Core catalogue and art requests work offline from the committed snapshot.

## Data and identity

The bundle contains all **1,451 source rows**, represented by **1,356 distinct
printings** after collapsing 95 exact duplicate records, across **eight sets**.
Every source row remains mapped in the manifest. All **1,171 unique WebPs** are
local, content addressed, checksum checked and decoded/dimension checked during
ingest. No sibling repository or third-party service is needed at runtime.

Use a set code and full collector/printing number, including alternate/signature
suffixes. Distinct records that reuse source IDs have deterministic hash suffixes.
Names never establish printing identity. Vendetta placeholder/conflicting records
remain as received, rather than being silently corrected or merged.

[Snapshot provenance, traps and regeneration](../shared/riftbound/README.md)
describe the original inputs, manifest and offline ingest. To validate and rebuild
from a separately downloaded snapshot:

```sh
node backend/scripts/ingest-riftbound.js /path/to/snapshot /tmp/riftbound-verified
```

## Everyday flows

Choose **Riftbound** in Search & Add, scan scope, collection/storage or decks.
Search by name, set code, collector number, or browse a set without a name.
English is the bundled catalogue's supported language. Binder pages retain the
existing `position = slot * 1000` placement contract; boxes use the same storage
engine. Decks support owned-card lists, exact-printing text export/import,
checkout locations and return. Exact deck list lines carry `[riftbound-…]` IDs;
ambiguous name-only imports need an explicit printing.

Provider prices are **TCGplayer market prices via TCGCSV** (category 89), matched to
the exact printing — set plus collector number, variant suffix included — so an
Overnumbered, Signature or alternate-art printing is priced off its own product and
never off the base print. Measured coverage of the bundled catalogue: 1,349 of 1,356
printings (99.5%); the five without a listing are PR promos TCGplayer does not carry.
A printing with no listing has a **null** price, never a zero and never a name-matched
approximation, and no price-history point is written for it. Owner-entered copy values
remain explicit user data and win over any provider price. Unpriced copies count toward
inventory and coverage, while all-unpriced valuation/ROI remain null; mixed totals
are labelled partial. JSON exports preserve status; internal CSV exports include
Game and Price Status with blank unknown Market Price.

Riftbound decks are casual inventory lists. Full tournament legality, separate
competitive deck zones, deck codes and digital gameplay are deliberately outside
this change. The UI groups card types, permits owned quantities, and does not
apply Pokémon's four-copy rule or draw/prize simulator to Riftbound.
No monetisation or automated Riftbound pricing is provided. No models, generated
embeddings, database or secrets are committed.

## Verification commands

Use Node 20 with the repository's locked dependencies:

```sh
npm ci --prefix backend
npm ci --prefix frontend
npm test
npm run lint --prefix frontend
npm run check:locales --prefix frontend
npm run build:frontend
git diff --check
```

Focused checks (from repository root):

```sh
node backend/test/riftboundingest.test.js
node backend/test/riftbound.test.js
node backend/test/e2e/riftbound.test.js
```

The provider test independently audits the entire bundled catalogue, printing
collisions, local art hashes and dimensions, exact set/number queries,
pagination, network independence, provider dispatch and null prices. The HTTP
round-trip suite uses a new SQLite database and blocks external network access:
search → local image bytes → add → binder page 2/pocket 5 → deck checkout/return →
dashboard/networth → JSON/CSV export and import, including box storage, public sharing, manual value overrides, user isolation and
missing-catalogue `503 notBuilt`. Frontend tests cover game settings, language
parity, unavailable prices and exact-printing deck text.

### Photo scanning with real models

Models are operator-managed, as for the other games. Download them explicitly,
then build the catalogue through **Admin → Catalogs → Riftbound / English**.
The usual detector, perspective warp, Milo embedding and confidence/manual-pick
flow are used; catalogue embedding reads local WebP bytes directly.

A reproducible real-model regression is available:

```sh
CV_MODEL_DIR=/tmp/bindarr-riftbound-models node backend/scripts/fetch-models.mjs
BINDARR_RIFTBOUND_SCAN=1 CV_MODEL_DIR=/tmp/bindarr-riftbound-models \
  BINDARR_SCAN_EVIDENCE=/tmp/bindarr-riftbound-scan-evidence.json \
  node backend/test/e2e/riftboundscan.test.js
```

The opt-in test copies the models into temporary state, builds all 1,356 printing
embeddings with external HTTP blocked, then posts the committed JPEG camera
fixtures through `/api/scan-match`. Normal tests skip this model-dependent step;
CI does not download weights. See the [photo fixture provenance](../backend/test/fixtures/riftbound/README.md).
The photos are camera captures of cards displayed on a monitor, with sleeves,
moire and glare. They establish this regression's results, not general scanning
accuracy or a live physical-card/phone camera claim.

## Verified local results

On Node 20: **54/54 backend unit files**, **8/8 E2E suites**, **12/12 frontend
utility suites**, frontend lint, locale validation and production build passed.
The browser check at 390px width verified search by OGN / 001, local art,
collection add, unavailable dashboard values, casual deck add and exact-ID text
export, with no horizontal page overflow. No remote CI run or deployment was
performed.

The real-model photo regression embedded **1,356 / 1,356** catalogue printings
into 128-dimensional vectors, with **zero failures** and external HTTP blocked:

| Camera fixture | Top match / score | Normal pipeline result |
| --- | --- | --- |
| Lonely Poro | Exact UNL 221 / 0.766 | Detected/dewarped; above confirmation threshold |
| Mystic Poro | Exact UNL 224 / 0.752 | Detected/dewarped; above confirmation threshold |
| Daring Poro | Exact UNL 225 / 0.545 | Detector fallback; manual review below threshold |
| Veteran Poro | Incorrect nearest candidate / 0.414 | Rejected as `notInCatalog`; no automatic match |

The confidence thresholds are unchanged. A nearest candidate is not treated as
an accepted identification. These four screen-photo fixtures are a bounded
regression, including a poor-image rejection, rather than an accuracy guarantee.

## Attribution

Bindarr was created under Riot Games' "Legal Jibber Jabber" policy using assets
owned by Riot Games. Riot Games does not endorse or sponsor this project.

Riftbound card names, text and art belong to Riot Games / UVS Games. This is a
personal, non-commercial project. The UI notice applies to authenticated screens
and public shares; local art/API/export surfaces also carry attribution.
[Riot Games fan project policy](https://www.riotgames.com/en/legal) and
[Riftbound developer policy](https://developer.riotgames.com/policies/riftbound).

All work is local. No push, PR, deployment, DNS or hosting change is part of this
implementation.
