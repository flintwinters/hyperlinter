"""Repeatable installation and deployment checks for the website's actual files."""
import json
import shlex
import subprocess
import tempfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from scripts.check_site import Page


def run(command, directory, allowed=(0,)):
    result = subprocess.run(command, cwd=directory, capture_output=True, text=True, timeout=180)
    if result.returncode not in allowed:
        raise SystemExit(f"site-install: {' '.join(command[:3])} failed\n{(result.stdout + result.stderr)[-1500:]}")
    return result.stdout


def check_install(root):
    page = Page((root / "docs/index.html").read_text())
    commands = [shlex.split(line) for line in ''.join(page.text['pre']).strip().splitlines()]
    if len(commands) != 3 or not any('src/cli.ts' in ' '.join(command) for command in commands):
        raise SystemExit('site-install: expected installation and CLI commands in the page.')
    (root / 'runtime').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='site-install-', dir=root / 'runtime') as directory:
        host = Path(directory)
        run(['git', 'init', '--quiet'], host)
        for command in commands:
            if command[:3] == ['git', 'submodule', 'add']:
                # Use the local committed repository; only the transport differs
                # from the published command. Dependencies still install via npm ci.
                command = ['git', '-c', 'protocol.file.allow=always', *command[1:3], str(root), *command[4:]]
            if 'src/cli.ts' in ' '.join(command):
                (host / 'tsconfig.json').write_text(json.dumps({'include': ['index.ts']}))
                (host / 'index.ts').write_text('export function first() { return 1; }\nexport function second() { return 2; }\n')
                output = run(command, host)
                if 'Module | Public surface' not in output:
                    raise SystemExit('site-install: command did not produce Hyperlinter diagnostics.')
            else:
                run(command, host)
        print('site-install: published commands passed in an isolated target repository.')


def check_live(root):
    site = root / 'docs'
    (root / 'runtime/pages').mkdir(parents=True, exist_ok=True)
    page = Page((site / 'index.html').read_text())
    canonical = next(attrs['href'] for tag, attrs in page.tags if tag == 'link' and attrs.get('rel') == 'canonical')
    urls = [urljoin(canonical, file.name) for file in site.iterdir() if file.suffix in ('.html', '.xml', '.svg')]
    urls[urls.index(urljoin(canonical, 'index.html'))] = canonical
    for url in urls:
        name = url.rsplit('/', 1)[-1] or 'index.html'
        request = Request(url, headers={'Cache-Control': 'no-cache'})
        with urlopen(request, timeout=20) as response:
            if url == canonical and 'noindex' in response.headers.get('X-Robots-Tag', '').lower():
                raise SystemExit('site-live: response header blocks indexing.')
            if response.status != 200 or response.read() != (site / name).read_bytes():
                raise SystemExit(f'site-live: deployment differs from checkout: {url}')
    try:
        urlopen(urljoin(canonical, 'audit-missing-page'), timeout=20)
        raise SystemExit('site-live: missing page returned a success status.')
    except HTTPError as error:
        if error.code != 404 or error.read() != (site / '404.html').read_bytes():
            raise SystemExit('site-live: expected the custom noindex 404 page.')
    origin = urljoin(canonical, '/robots.txt')
    try:
        with urlopen(origin, timeout=20) as response:
            text = response.read().decode()
            (root / 'runtime/pages/robots.txt').write_text(text)
            print('site-live: origin robots.txt saved for policy review in runtime/pages/robots.txt.')
    except HTTPError as error:
        if error.code != 404:
            raise SystemExit(f'site-live: robots.txt returned HTTP {error.code}.')
        print('site-live: origin robots.txt absent (HTTP 404); no file-based crawl restrictions.')
    print('site-live: HTTPS page, assets, sitemap, and custom 404 match checkout.')
