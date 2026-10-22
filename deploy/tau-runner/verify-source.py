"""Verify the exact official runner source reviewed for admission semantics."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--source-dir', type=Path)
args = parser.parse_args()
contract = json.loads(Path(__file__).with_name('runner-hook-contract.json').read_text())
for source in contract['sources']:
    if args.source_dir:
        body = (args.source_dir / source['local']).read_bytes()
    else:
        url = 'https://raw.githubusercontent.com/actions/runner/' + contract['commit'] + '/' + source['path']
        with urllib.request.urlopen(url, timeout=20) as response:
            body = response.read(1024 * 1024 + 1)
    if len(body) > 1024 * 1024 or hashlib.sha256(body).hexdigest() != source['sha256']:
        raise SystemExit('Runner source contract mismatch: ' + source['path'])
    print(source['sha256'], source['path'])
print('Official admission source contract verified: ' + contract['version'] + ' ' + contract['commit'])
