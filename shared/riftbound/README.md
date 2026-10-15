# Riftbound offline catalogue

This personal, non-commercial catalogue is a self-contained copy of the owner's
verified RiftCodex snapshot. Bindarr reads only this directory at runtime; it does
not import or contact another local project, RiftCodex, or an art CDN for search,
set browsing, adding cards, or serving reference art.

- Source: `https://api.riftcodex.com/cards` (community API, no key, browser User-Agent required when refreshing upstream).
- Source timestamp: `2026-09-30T04:08:23+00:00`.
- Source records: **1,451**, all retained byte for byte in `cards.json`.
- Distinct full records: **1,356**. The 95 byte-equivalent JSON duplicates collapse into one selectable printing; every original row index remains mapped in `manifest.json`.
- Art: **1,171 unique WebP files**, identified by SHA-256. The upstream manifest contains URL aliases to identical files; a URL count is not a unique file count.
- Prices: **unavailable**. No exact-printing price source with an approved licence has been verified. No name search, guessed price, price-history zero, or marketplace product link is substituted. User-entered copy values remain user data.

`cards.json` and `art-manifest.json` preserve the original input bytes. The
Bindarr `manifest.json` binds those inputs by SHA-256, records image dimensions
and byte lengths, and maps each distinct printing to all its source rows. Assets
live at `art/<sha256>.webp` and are served as
`/api/riftbound/art/<sha256>.webp` with the same attribution notice as the UI.
The backend provider additionally checks snapshot checksums before using data.

## Regenerate from a downloaded snapshot

Install the existing backend dependencies, then run from the repository root:

```sh
node backend/scripts/ingest-riftbound.js /path/to/downloaded-snapshot
node backend/scripts/ingest-riftbound.js --help
```

The input directory must contain `cards.json`, `art-manifest.json`, and every
referenced `art/*.webp`. The optional second argument selects a separate output
directory. Ingest performs no network requests. It validates record counts,
identity links, the snapshot checksum, every artwork checksum/byte length,
actual WebP dimensions, and full image decoding **before writing any output**.
Absolute, escaping, or symlink-escaping artwork paths are rejected. Incomplete
snapshots and conflicting image links fail explicitly. Re-running identical
inputs produces identical JSON and content-addressed files.

Refreshing or obtaining a snapshot is an explicit operator action. The sibling
source project's `scripts/fetch-cards.py` produced the original input; it is not
imported or used by Bindarr. A future upstream refresh should be reviewed for
identity/metadata changes before replacing this committed snapshot.

## Identity and text

Identity is the set plus the exact printing number, never a card name. Source
`collector_number` is numeric and loses alternate-art letters and signature
stars; Bindarr's `number` preserves the full printing token from `riftbound_id`
(for example `001a`, `229*`, `sp4`, or `r06`). Numeric searches find numbered
variants; a suffix query matches that suffix exactly. The source's numeric value
is retained separately as `collector_number`.

Source IDs also collide: Metal variants can reuse the same source ID, and some
Vendetta records have conflicting or placeholder metadata. A source ID shared by
multiple distinct full records receives a stable `-v<record-sha256-prefix>`
suffix. Exact duplicate full records collapse, while distinct source records
remain separate choices. No name-based merge or guessed correction is applied.

The source carries `keywords`, `play_keywords`, `ability_keywords`, and
`referenced_keywords`, preserving the upstream reminder-text-aware parser. Do
not derive play permissions by scanning raw `[Reaction]`: Ambush reminder text
mentions Reaction without granting it. Preserve hyphens and numbers in labels
such as `[Quick-Draw]` and `[Assault 2]`. The provider decodes HTML entities and
separates glued brackets, uses `text_clean` to display expanded `:rb_*:` tokens,
and retains raw text and explicit timing fields. Battlefield landscape art and
its opponent-facing, upside-down frame text are intentional.

The snapshot is English. Selecting an unsupported language yields no printings;
there is no invented translation or cross-language identity conversion.

## Attribution

Riot's [Riftbound developer policy](https://developer.riotgames.com/policies/riftbound)
requires the following notice for projects using these assets:

Bindarr was created under Riot Games' "Legal Jibber Jabber" policy using assets
owned by Riot Games. Riot Games does not endorse or sponsor this project.

Riftbound card names, rules text and art belong to Riot Games / UVS Games. This
snapshot is used for the owner's personal, non-commercial collection management.
