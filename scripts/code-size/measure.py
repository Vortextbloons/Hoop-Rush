#!/usr/bin/env python3
"""Code-size harness for Hoop Rush.

Measures Git-tracked plus non-ignored untracked source files and splits them
into maintained-source buckets, so net reduction can be measured separately
from tests, styles, docs, and generated data.

Usage:
  python scripts/code-size/measure.py [--output PATH]

Buckets (role):
  runtime     production TS/JS under apps/*/src, packages/*/src, tools/*/src
  scripts     production code under scripts/
  config      tool config files (eslint/vitest/vite/svelte/tailwind/...)
  ui-script   <script> sections of .svelte files
  ui-markup   remaining .svelte lines
  styles      .css/.scss files and <style> sections of .svelte files
  test        test files and test directories
  sql         .sql files (Supabase)
  html        .html files

Headline metric: maintained source = runtime + scripts + ui-script + ui-markup.
"""

import argparse
import collections
import json
import pathlib
import re
import subprocess

EXTENSIONS = {
    '.ts', '.js', '.mjs', '.cjs', '.svelte', '.css', '.scss',
    '.html', '.py', '.sql', '.sh', '.ps1',
}
TEST_PATH = re.compile(
    r'(^|/)(__tests__|tests|test)/|\.(test|spec)\.|(^|/)test_[^/]+\.py$'
)
CONFIG_NAME = re.compile(
    r'^(eslint|vitest|vite|svelte|tailwind|postcss|prettier|playwright)\.config\.'
)
SCRIPT_SECTION = re.compile(r'<script\b[^>]*>(.*?)</script>', re.DOTALL)
STYLE_SECTION = re.compile(r'<style\b[^>]*>(.*?)</style>', re.DOTALL)
HEADLINE_ROLES = ('runtime', 'scripts', 'ui-script', 'ui-markup')


def area_of(path):
    if path.startswith(('apps/', 'packages/', 'tools/')):
        return '/'.join(path.split('/')[:2])
    return path.split('/')[0]


def role_of(path, ext):
    if TEST_PATH.search(path):
        return 'test'
    if ext == '.sql':
        return 'sql'
    if ext == '.html':
        return 'html'
    if ext in ('.css', '.scss'):
        return 'styles'
    if path.startswith('scripts/'):
        return 'scripts'
    basename = path.rsplit('/', 1)[-1]
    if CONFIG_NAME.match(basename) or basename == 'eslint.base.config.js':
        return 'config'
    return 'runtime'


def section_counts(block):
    lines = block.splitlines()
    return len(lines), sum(bool(line.strip()) for line in lines)


def svelte_sections(text):
    script = [0, 0]
    style = [0, 0]
    for block in SCRIPT_SECTION.findall(text):
        lines, nonblank = section_counts(block)
        script[0] += lines
        script[1] += nonblank
    for block in STYLE_SECTION.findall(text):
        lines, nonblank = section_counts(block)
        style[0] += lines
        style[1] += nonblank
    lines = text.splitlines()
    markup = max(0, len(lines) - script[0] - style[0])
    markup_nonblank = max(0, sum(bool(line.strip()) for line in lines) - script[1] - style[1])
    return (*script, *style, markup, markup_nonblank)


def measure(root):
    output = subprocess.check_output(
        ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        cwd=root,
    )
    rows = []
    for name in sorted(set(output.decode('utf-8').split('\0'))):
        path = root / name
        if not path.is_file() or path.suffix not in EXTENSIONS:
            continue
        text = path.read_text(encoding='utf-8-sig', errors='replace')
        lines = len(text.splitlines())
        row = {
            'path': name,
            'lines': lines,
            'nonblank': sum(bool(line.strip()) for line in text.splitlines()),
            'kind': 'test' if TEST_PATH.search(name) else 'production',
            'area': area_of(name),
            'ext': path.suffix,
        }
        if path.suffix == '.svelte':
            (script, script_nb, style, style_nb,
             markup, markup_nb) = svelte_sections(text)
            row.update({
                'role': 'ui',
                'uiScript': script,
                'uiScriptNonblank': script_nb,
                'uiStyle': style,
                'uiStyleNonblank': style_nb,
                'uiMarkup': markup,
                'uiMarkupNonblank': markup_nb,
            })
        else:
            row['role'] = role_of(name, path.suffix)
        rows.append(row)
    return rows


def summarize(rows):
    roles = collections.defaultdict(lambda: [0, 0])
    areas = collections.defaultdict(lambda: [0, 0])
    headline = [0, 0]
    for row in rows:
        if row['ext'] == '.svelte':
            buckets = [
                ('ui-script', row['uiScript'], row['uiScriptNonblank']),
                ('styles', row['uiStyle'], row['uiStyleNonblank']),
                ('ui-markup', row['uiMarkup'], row['uiMarkupNonblank']),
            ]
        else:
            buckets = [(row['role'], row['lines'], row['nonblank'])]
        for role, physical, nonblank in buckets:
            roles[role][0] += physical
            roles[role][1] += nonblank
            if role in HEADLINE_ROLES:
                headline[0] += physical
                headline[1] += nonblank
        areas[row['area']][0] += row['lines']
        if row['kind'] == 'production' and row['role'] != 'test':
            areas[row['area']][1] += row['lines']
    return roles, areas, headline


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=pathlib.Path)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    rows = measure(root)
    roles, areas, headline = summarize(rows)

    total = sum(row['lines'] for row in rows)
    nonblank = sum(row['nonblank'] for row in rows)
    tests = roles['test'][0]
    print(f'{total:,} physical lines; {nonblank:,} nonblank; {len(rows)} files')
    print(f'maintained source: {headline[0]:,} physical '
          f'(runtime + scripts + svelte script + svelte markup)')
    print()
    print(f'{"role":14} {"physical":>9} {"nonblank":>9}')
    for role, (physical, nb) in sorted(roles.items(), key=lambda item: -item[1][0]):
        label = f'{role}*' if role in HEADLINE_ROLES else role
        print(f'{label:14} {physical:>9,} {nb:>9,}')
    print()
    print(f'{"area":30} {"physical":>9} {"production":>11}')
    for area, (physical, production) in sorted(areas.items(), key=lambda item: -item[1][0]):
        print(f'{area:30} {physical:>9,} {production:>11,}')
    print()
    print(f'tests: {tests:,} physical lines (separate from maintained source)')

    if args.output:
        commit = subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=root, text=True
        ).strip()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps({
            'metric': 'physical lines; Git tracked + nonignored untracked code files',
            'commit': commit,
            'headline': {
                'description': 'maintained source = runtime + scripts + ui-script + ui-markup',
                'physical': headline[0],
            },
            'roles': {
                role: {'physical': counts[0], 'nonblank': counts[1]}
                for role, counts in sorted(roles.items())
            },
            'files': rows,
        }, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
