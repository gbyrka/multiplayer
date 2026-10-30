#!/usr/bin/env python3
"""Reproducible offline dictionaries. Python 3 + POSIX sort, no third-party packages.

Sources are cached outside the checkout. See ../data/README.md for filtering and licenses.
"""
import argparse
import array
import gzip
import hashlib
import json
import re
from pathlib import Path
import struct
import subprocess
import sys
import urllib.request

ALPHABET = 'abcdefghijklmnopqrstuvwxyząćęłńóśźż'
INDEX = {char: index for index, char in enumerate(ALPHABET)}
SGJP = 'https://download.sgjp.pl/morfeusz/20261018/sgjp-20261018.tab.gz'
ESDB = 'https://raw.githubusercontent.com/en-wl/wordlist-diff/{revision}/'
ROOT = Path(__file__).resolve().parents[1]


def download(url, target):
    if not target.exists():
        print('Downloading', url, flush=True)
        urllib.request.urlretrieve(url, target)
    return target


def eligible(word):
    return bool(word) and all(char in INDEX for char in word)


def polish(source, output, license_path):
    excluded = {'brev', 'frag', 'aglt', 'adja', 'adjp', 'pacta', 'numcomp'}
    count = 0
    license_lines = []
    in_license = False
    with gzip.open(source, 'rt', encoding='utf-8') as stream, output.open('w', encoding='utf-8') as out:
        for line in stream:
            if line.startswith('#<COPYRIGHT>'):
                in_license = True
                continue
            if line.startswith('#</COPYRIGHT>'):
                in_license = False
                continue
            if in_license:
                license_lines.append(line)
            if line.startswith('#'):
                continue
            columns = line.rstrip('\n').split('\t')
            if len(columns) < 5:
                continue
            form, lemma, tag, names, labels = columns[:5]
            if not eligible(form) or not lemma[0].islower() or tag.split(':')[0] in excluded:
                continue
            if names and 'nazwa_pospolita' not in names.split('|'):
                continue
            # Retain contemporary ordinary and specialist meanings. Any eligible meaning suffices.
            if any(label in {'daw.', 'przest.'} for label in labels.replace(',', '|').split('|')):
                continue
            out.write(form + '\n')
            count += 1
    license_path.write_text(''.join(license_lines), encoding='utf-8')
    return count


def compile_dawg(source, target):
    """Minimal acyclic word graph from a sorted stream; suffixes share immutable nodes.

    Header: WTR1, root, node count, edge count (little endian uint32).
    Node offset: (first edge << 1) | terminal; extra sentinel offset at the end.
    Edge: (destination << 6) | alphabet index. Includes words of every length.
    """
    register, nodes, path = {}, [], [[False, {}]]
    previous, count, longest = '', 0, 0

    def intern(node):
        signature = (node[0], tuple(sorted(node[1].items())))
        if signature not in register:
            register[signature] = len(nodes)
            nodes.append(signature)
        return register[signature]

    def close_to(depth):
        while len(path) > depth + 1:
            child = intern(path.pop())
            path[-1][1][INDEX[previous[len(path) - 1]]] = child

    with source.open(encoding='utf-8') as stream:
        for line in stream:
            word = line.rstrip('\n')
            if not word:
                continue
            common = 0
            while common < min(len(word), len(previous)) and word[common] == previous[common]:
                common += 1
            close_to(common)
            for char in word[common:]:
                path.append([False, {}])
            path[-1][0] = True
            previous = word
            count += 1
            longest = max(longest, len(word))
    close_to(0)
    root = intern(path[0])
    offsets, edges = array.array('I'), array.array('I')
    for terminal, children in nodes:
        offsets.append((len(edges) << 1) | int(terminal))
        for char, child in children:
            edges.append((child << 6) | char)
    offsets.append(len(edges) << 1)
    if sys.byteorder != 'little':
        offsets.byteswap()
        edges.byteswap()
    binary = struct.pack('<4sIII', b'WTR1', root, len(nodes), len(edges)) + offsets.tobytes() + edges.tobytes()
    compressed = gzip.compress(binary, compresslevel=9, mtime=0)
    target.write_bytes(compressed)
    return dict(words=count, longest=longest, nodes=len(nodes), edges=len(edges), bytes=len(compressed),
                sha256=hashlib.sha256(compressed).hexdigest())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, default=Path('/tmp/boggle-sources'))
    parser.add_argument('--esdb-revision', help='Immutable commit in en-wl/wordlist-diff; defaults to existing manifest')
    args = parser.parse_args()
    cache = args.cache
    cache.mkdir(parents=True, exist_ok=True)
    dest = ROOT / 'data'
    dest.mkdir(exist_ok=True)
    old = json.loads((dest / 'manifest.json').read_text()) if (dest / 'manifest.json').exists() else {}
    revision = args.esdb_revision or old.get('sources', {}).get('esdbRevision')
    if not revision:
        raise SystemExit('Supply --esdb-revision with an immutable commit hash.')
    source = download(SGJP, cache / 'sgjp-20261018.tab.gz')
    polish(source, cache / 'pl.unsorted', dest / 'LICENSE-SGJP.txt')
    english = set()
    for name in ['en_US-large', 'en_GB-large']:
        file = download(ESDB.format(revision=revision) + name + '.txt', cache / (revision + '-' + name + '.txt'))
        english.update(word for word in file.read_text().splitlines() if eligible(word) and word.isascii())
    # Plain spell-checker lists include lowercase abbreviations (aka, etc, mph).
    # Consult source POS tags before filtering; keep homonyms with an ordinary meaning (am).
    metadata = download(ESDB.format(revision=revision) + 'scowl.txt', cache / (revision + '-scowl.txt'))
    fragments, ordinary = set(), set()
    for line in metadata.read_text().splitlines():
        match = re.search(r':\s+([^\s<>:]+)\s+<([^>]*)>', line)
        if not match:
            continue
        token, tag = match.groups()
        word = token.lstrip('-!*~=')
        fragment = 'abbr' in tag or tag.split('/')[0] in {'pre', 'suf'}
        # A homonym may be an irregular inflection rather than a headword (be → am).
        for inflection in re.split(r'[(),|:\s]+', line[match.end():]):
            form = inflection.strip('-~†‡!*=')
            if eligible(form) and form.isascii():
                (fragments if fragment else ordinary).add(form)
        if not eligible(word) or not word.isascii():
            continue
        if fragment:
            fragments.add(word)
        elif not token.startswith('-'):
            ordinary.add(word)
    english.difference_update(fragments - ordinary)
    (cache / 'en.unsorted').write_text('\n'.join(sorted(english)) + '\n')
    license_file = download(ESDB.format(revision=revision) + 'Copyright', cache / (revision + '-Copyright'))
    (dest / 'LICENSE-ESDB.txt').write_bytes(license_file.read_bytes())
    manifest = {'version': 'boggle1', 'alphabet': ALPHABET, 'sources': {'sgjp': SGJP, 'esdbRevision': revision}, 'languages': {}}
    for language in ['pl', 'en']:
        ordered = cache / (language + '.sorted')
        subprocess.run(['sort', '-u', '-o', str(ordered), str(cache / (language + '.unsorted'))], env={'LC_ALL': 'C'}, check=True)
        manifest['languages'][language] = compile_dawg(ordered, dest / (language + '.bin.gz'))
        print(language, manifest['languages'][language], flush=True)
    (dest / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
