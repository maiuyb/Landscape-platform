"""Import verified pairs into an existing community database; dry-run by default.

Preserves source-matched work IDs, owners, favorites and dates. Does not create
accounts, fabricate likes, reset works or restore deliberately deleted records.
"""
import argparse
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys
from urllib.parse import urlsplit
import uuid
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / '风景调色协作平台/backend'
if not BACKEND.is_dir():
    BACKEND = Path('/opt/landscape/current/风景调色协作平台/backend')
sys.path.insert(0, str(BACKEND))
from community_modules.recipe_schema import validate_recipe


def digest_file(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def digest_json(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def read_bundle(folder, limit=None):
    folder = Path(folder).resolve()
    body = json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
    if not isinstance(body, dict) or body.get('format_version') != 1 or body.get('verified') != 'browser-full-render-lossless-webp':
        raise ValueError('Use the verified bundle from prepare-community-library.cjs')
    dataset, items = body.get('dataset', ''), body.get('items')
    if not re.fullmatch(r'[a-z0-9-]{1,80}', dataset) or not isinstance(items, list) or not 1 <= len(items) <= 200:
        raise ValueError('Invalid dataset or asset count')
    seen, prepared = set(), []
    for item in items:
        source_id = item.get('id', '')
        if not re.fullmatch(r'landscape_[0-9]{3}', source_id) or source_id in seen:
            raise ValueError('Invalid or duplicate asset ID')
        seen.add(source_id)
        recipe, error = validate_recipe(item)
        if error:
            raise ValueError(source_id + ': ' + error)
        for field in ('source_sha256', 'before_sha256', 'after_sha256'):
            if not re.fullmatch(r'[a-f0-9]{64}', item.get(field, '')):
                raise ValueError('Missing verified hash: ' + source_id)
        for field in ('source_url', 'license_url'):
            url = urlsplit(item.get(field, ''))
            if url.scheme not in ('https', 'http') or not url.netloc or url.username or url.password:
                raise ValueError('Invalid attribution link: ' + source_id)
        for field in ('author', 'license', 'parameter_summary', 'before_note'):
            if not isinstance(item.get(field), str) or not item[field].strip() or len(item[field]) > 4000:
                raise ValueError('Missing attribution or summary: ' + source_id)
        if not isinstance(item.get('name'), str) or not 1 <= len(item['name']) <= 50:
            raise ValueError('Invalid title: ' + source_id)
        if not isinstance(item.get('category'), str) or not 1 <= len(item['category']) <= 30:
            raise ValueError('Invalid category: ' + source_id)
        tags = item.get('tags', [])
        if not isinstance(tags, list) or len(tags) > 10 or any(not isinstance(t, str) or len(t) > 20 for t in tags):
            raise ValueError('Invalid tags: ' + source_id)
        files = []
        for side, extension in [('before', 'jpg'), ('after', 'webp')]:
            expected = f'{side}/{source_id}.{extension}'
            if item.get('cover_' + side) != expected:
                raise ValueError('Unexpected asset path: ' + source_id)
            path = (folder/expected).resolve()
            if not path.is_relative_to(folder) or not path.is_file() or digest_file(path) != item[side + '_sha256']:
                raise ValueError('Asset missing or hash mismatch: ' + source_id)
            with Image.open(path) as image:
                if image.size != (item['width'], item['height']) or image.width * image.height > 40_000_000:
                    raise ValueError('Unexpected dimensions: ' + source_id)
                image.verify()
            name = f'library-{source_id}-{side}-{item[side + "_sha256"][:16]}.{extension}'
            files.append((path, name, item[side + '_sha256']))
        values = dict(name=item['name'], description=str(item.get('description', '')).split('（参数：', 1)[0].strip()[:200],
                      category=item['category'], tags=json.dumps(tags, ensure_ascii=False), version=recipe['version'],
                      rendering=json.dumps(recipe['rendering'], ensure_ascii=False), steps=json.dumps(recipe['steps'], ensure_ascii=False),
                      features=json.dumps(item.get('features', {}), ensure_ascii=False),
                      cover_before='/uploads/' + files[0][1], cover_after='/uploads/' + files[1][1], pairing='editor')
        source = dict(dataset=dataset, source_id=source_id, photographer=item['author'], source_url=item['source_url'],
                      license=item['license'], license_url=item['license_url'], before_note=item['before_note'],
                      parameter_summary=item['parameter_summary'], source_sha256=item['source_sha256'])
        source['content_digest'] = digest_json([values, source])
        prepared.append(dict(values=values, source=source, files=files))
    return dataset, prepared[:limit] if limit else prepared


def connection(database):
    conn = sqlite3.connect(database, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def make_plan(conn, assets, owner, allow_new=False):
    user = conn.execute('SELECT id,username FROM users WHERE username=?', (owner,)).fetchone()
    if not user:
        raise ValueError('Target owner does not exist; no accounts are created')
    has_sources = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recipe_sources'").fetchone()
    owned, plan = conn.execute('SELECT * FROM recipes WHERE author_id=?', (user['id'],)).fetchall(), []
    for asset in assets:
        source = asset['source']
        mapped = conn.execute('SELECT * FROM recipe_sources WHERE dataset=? AND source_id=?',
                              (source['dataset'], source['source_id'])).fetchone() if has_sources else None
        row = conn.execute('SELECT * FROM recipes WHERE id=?', (mapped['recipe_id'],)).fetchone() if mapped else None
        if mapped and (not row or row['author_id'] != user['id']):
            raise ValueError('Imported work ownership changed: ' + source['source_id'])
        if not row:
            prefix = 'import-' + source['source_sha256'] + '.'
            matches = [r for r in owned if any(Path(urlsplit(r[key] or '').path).name.startswith(prefix)
                                              for key in ('cover_before', 'cover_after'))]
            if len(matches) > 1:
                raise ValueError('Ambiguous source photograph: ' + source['source_id'])
            row = matches[0] if matches else None
        if not row and not allow_new:
            raise ValueError('No existing work matches ' + source['source_id'] + '; use --allow-new for a new library')
        status = 'insert' if not row else 'update'
        if row and row['deleted_at']:
            status = 'deleted-skip'
        elif row and mapped and mapped['content_digest'] == source['content_digest'] and all(row[k] == v for k, v in asset['values'].items()):
            status = 'unchanged'
        plan.append(dict(asset=asset, recipe_id=row['id'] if row else None, status=status,
                         fingerprint=digest_json(dict(row)) if row else None,
                         owner_id=user['id'], owner_name=user['username']))
    return plan


def write_source(conn, recipe_id, values):
    fields = list(values)
    conn.execute('INSERT INTO recipe_sources(recipe_id,' + ','.join(fields) + ') VALUES(' +
                 ','.join('?' for _ in range(len(fields) + 1)) + ') ON CONFLICT(recipe_id) DO UPDATE SET ' +
                 ','.join(f'{k}=excluded.{k}' for k in fields), [recipe_id, *values.values()])


@contextmanager
def import_lock(database):
    with (database.parent/'.community-import.lock').open('a+b') as lock:
        if os.name == 'nt':
            import msvcrt
            lock.write(b'0');lock.flush();lock.seek(0);msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            try:yield
            finally:lock.seek(0);msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:yield
            finally:fcntl.flock(lock, fcntl.LOCK_UN)


def import_bundle(database, uploads, assets, owner='demo', *, apply=False, allow_new=False, warm=False):
    database, uploads = Path(database).resolve(), Path(uploads).resolve()
    if not database.is_file() or not uploads.is_dir():
        raise ValueError('Explicit existing database and uploads directory are required')
    if not apply:
        return run_import(database, uploads, assets, owner, False, allow_new, warm)
    with import_lock(database):
        return run_import(database, uploads, assets, owner, True, allow_new, warm)


def run_import(database, uploads, assets, owner, apply, allow_new, warm):
    with closing(connection(database)) as conn:
        plan = make_plan(conn, assets, owner, allow_new)
    changes = [entry for entry in plan if entry['status'] in ('insert', 'update')]
    report = {status: sum(e['status'] == status for e in plan) for status in ('insert', 'update', 'unchanged', 'deleted-skip')}
    report.update(applied=False, backup=None)
    if not apply or not changes:
        return report
    backups = database.parent/'backups';backups.mkdir(exist_ok=True)
    backup = backups/('community-import-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f') + '.db')
    with closing(connection(database)) as original, closing(sqlite3.connect(backup)) as target:
        original.backup(target)
    backup.chmod(0o600)
    from flask import Flask
    app = Flask(__name__);app.config['COMMUNITY_DB_PATH'] = str(database)
    with app.app_context():
        from community_modules.db import init_db
        init_db()
    created = []
    try:
        for entry in changes:
            for source, name, expected in entry['asset']['files']:
                target = uploads/name
                if target.exists():
                    if digest_file(target) != expected:
                        raise ValueError('Existing asset hash mismatch: ' + name)
                    continue
                temporary = uploads/('.tmp-library-' + uuid.uuid4().hex)
                try:
                    shutil.copyfile(source, temporary)
                    if digest_file(temporary) != expected:
                        raise ValueError('Source changed during copy: ' + name)
                    temporary.chmod(0o644);os.replace(temporary, target);created.append(target)
                finally:temporary.unlink(missing_ok=True)
        if warm:
            from thumbnails import build_thumbnail
            for entry in changes:
                for width in (800, 1200):
                    if not build_thumbnail(uploads, entry['asset']['files'][1][1], width):
                        raise ValueError('Thumbnail preparation failed')
        with closing(connection(database)) as conn:
            conn.execute('BEGIN IMMEDIATE')
            try:
                current = make_plan(conn, assets, owner, allow_new)
                if [(p['recipe_id'], p['status'], p['fingerprint']) for p in current] != [(p['recipe_id'], p['status'], p['fingerprint']) for p in plan]:
                    raise ValueError('Community changed during preparation; retry the import')
                for entry in changes:
                    values = entry['asset']['values'];fields = list(values)
                    if entry['status'] == 'insert':
                        cursor = conn.execute('INSERT INTO recipes(author_id,author,' + ','.join(fields) + ') VALUES(' +
                                              ','.join('?' for _ in range(len(fields) + 2)) + ')',
                                              [entry['owner_id'], entry['owner_name'], *values.values()])
                        recipe_id = cursor.lastrowid
                    else:
                        recipe_id = entry['recipe_id']
                        conn.execute('UPDATE recipes SET ' + ','.join(k + '=?' for k in fields) + ' WHERE id=? AND author_id=?',
                                     [*values.values(), recipe_id, entry['owner_id']])
                    write_source(conn, recipe_id, entry['asset']['source'])
                conn.commit()
            except BaseException:conn.rollback();raise
    except BaseException:
        for path in created:path.unlink(missing_ok=True)
        raise
    report.update(applied=True, backup=str(backup))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', required=True, type=Path)
    parser.add_argument('--database', required=True, type=Path)
    parser.add_argument('--uploads', required=True, type=Path)
    parser.add_argument('--owner', default='demo')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--allow-new', action='store_true')
    parser.add_argument('--apply', action='store_true', help='Apply; omitted means dry-run')
    parser.add_argument('--warm-thumbnails', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if not args.database.is_absolute() or not args.uploads.is_absolute() or (args.limit is not None and not 1 <= args.limit <= 200):
        parser.error('Use absolute persistent paths and a limit of 1–200')
    try:
        dataset, assets = read_bundle(args.assets, args.limit)
        report = import_bundle(args.database, args.uploads, assets, args.owner, apply=args.apply,
                               allow_new=args.allow_new, warm=args.warm_thumbnails)
        report['dataset'] = dataset
        if args.report:args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False))
    except (ValueError, OSError, sqlite3.Error) as error:parser.exit(1, str(error) + '\n')


if __name__ == '__main__':main()
