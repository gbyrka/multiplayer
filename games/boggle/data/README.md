# Boggle dictionaries

These are **game dictionaries**, not official tournament Boggle or Scrabble lists.
They are distributed locally; no word lookup is sent to a third-party service.
The host alone downloads the selected language, in a module worker, before a round.

## Pinned sources and licenses

- **Polish:** SGJP, Morfeusz release `20261018`, dictionary ID `pl.sgjp.sgjp-2026.10.19`.
  Source: <https://download.sgjp.pl/morfeusz/20261018/sgjp-20261018.tab.gz>.
  Redistribution notice: [LICENSE-SGJP.txt](LICENSE-SGJP.txt).
- **English:** ESDB / SCOWL, union of `en_US-large.txt` and `en_GB-large.txt`,
  pinned to the immutable commit recorded in [manifest.json](manifest.json).
  Source: <https://github.com/en-wl/wordlist-diff>.
  Original notices for ESDB and its constituent sources: [LICENSE-ESDB.txt](LICENSE-ESDB.txt).

The repository's MIT license does not replace these data licenses. Notices are
also linked from the game's About dialog. As the ESDB authors explain at
<https://wordlist.aspell.net/dicts/>, large dictionaries include obscure words and
are less carefully checked than the default spell-checker dictionaries.

## Filtering policy

- Retain **complete words of every length**. The board, not the stored dictionary,
  imposes the playable maximum (16, 25 or 36 one-letter tiles).
- Only lowercase alphabetic entries: `a–z` plus Polish `ąćęłńóśźż`. Do not strip
  accents, apostrophes or hyphens to invent new words. English uses only `a–z`.
- Polish: retain a form if **any** interpretation has a lowercase lemma and is
  ordinary vocabulary. Remove proper-name-only interpretations, abbreviations
  and non-independent morphological segments (`brev`, `frag`, `aglt`, `adja`,
  `adjp`, `pacta`, `numcomp`). Exclude interpretations marked `daw.` or `przest.`
  (historical/obsolete). Other contemporary, technical, colloquial and regional
  vocabulary remains eligible. A historical meaning does not disqualify another
  contemporary meaning with the same spelling. The new SGJP export contains
  complete past-tense and conditional forms, including `szedłem` and `zrobiłbym`.
- English: preserve both dialects and all listed inflections, including irregular
  ones. Remove uppercase/mixed-case names and abbreviations before normalization.
  Use source POS metadata from `scowl.txt` to remove lowercase abbreviations and
  prefix/suffix-only entries. Keep homonyms with an ordinary headword or inflected
  interpretation (`am`, `may`, `cant`). The data still define validity; this is
  not a promise that every linguistically possible word is covered.
- Deduplicate spellings. Distinct inflections remain distinct words. Proper-name
  homonyms such as `polska` or the ordinary `warszawa` entry are retained.
- Runtime input is trimmed, normalized to Unicode NFC and lowercased; Polish
  diacritics are preserved. Minimum length 3, 4 or 5 is a **room setting** applied
  after dictionary loading, not a different dictionary version.

`manifest.json` records word counts, longest stored forms, graph sizes and SHA-256
hashes. Both compressed binaries together are about 1.2 MB. The graphs occupy
about 2.5 MB uncompressed; suffix sharing avoids creating millions of JS objects.

## Rebuild

Python 3 and POSIX `sort` are development tools only:

```sh
python3 games/boggle/tools/build-dictionaries.py
```

Run from the `multiplayer` checkout. Sources are downloaded into
`/tmp/boggle-sources` by default (`--cache` overrides it). The existing
manifest pins the English revision; `--esdb-revision <commit>` explicitly updates
it. The build retains the original copyright notices and emits deterministic
gzip files with a zero modification timestamp. When changing released binaries
or filters, bump the dictionary version in the manifest, worker, board and rules
adapter, along with the application's release version.

`WTR1` is a minimal deterministic acyclic word graph. Its 16-byte header contains
the magic, root ID, node count and edge count as little-endian uint32s. Next come
`nodeCount + 1` uint32 offsets: `(firstEdge << 1) | isTerminal`, followed by uint32
edges `(childId << 6) | alphabetIndex`. The alphabet is recorded in the manifest
and in `dictionary.mjs`. Edges are sorted by index; children precede their parent.
The loader validates offsets, labels and this acyclic ordering before traversal.

## Verification

The Node suite checks packaged hashes and independently counts accepted words in
the graph. It exercises real PL/EN inflections, spelling variants, accents,
misspellings, proper-name-only entries, abbreviations and very long words. The
browser test loads the production worker and binaries over HTTP in a real
two-player WebRTC session. Dictionary updates should retain these checks and
review added/removed entries before release.
