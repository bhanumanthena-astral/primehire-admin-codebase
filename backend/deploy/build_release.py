"""Build a backend-only source release; never package environments or user data."""
import argparse
import hashlib
import io
import json
import re
import tarfile
from datetime import datetime, timezone
from pathlib import Path


def release_files(root):
    root = root.resolve()
    selected = [root / 'requirements-production.txt']
    for directory in ['app','migrations','deploy']:
        for file in sorted((root / directory).rglob('*')):
            if not file.is_file() or '__pycache__' in file.parts:
                continue
            if directory != 'deploy' and file.suffix != '.py':
                continue
            if directory == 'deploy' and file.suffix not in {'.py','.sh','.service','.timer','.slice','.example','.md'}:
                continue
            selected.append(file)
    for file in selected:
        if file.is_symlink() or not file.resolve().is_relative_to(root):
            raise ValueError('Release files must not resolve outside the backend.')
        if not file.is_file():
            raise ValueError(f'Required release file missing: {file.name}')
    return selected


def build(root, output, version):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', version):
        raise ValueError('Unsafe release version')
    root = root.resolve()
    files = release_files(root)
    manifest = {'version':version, 'database':'primehire_admin_v2', 'files':{
        file.relative_to(root).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest() for file in files}}
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f'elitehr-backend-{version}.tar.gz'
    if archive.exists():
        raise ValueError('Release exists; choose a new version')
    with tarfile.open(archive, 'w:gz') as stream:
        for file in files:
            data = file.read_bytes()
            member = tarfile.TarInfo(file.relative_to(root).as_posix())
            member.size = len(data)
            member.mode = 0o755 if file.suffix == '.sh' else 0o644
            stream.addfile(member, io.BytesIO(data))
        data = json.dumps(manifest, sort_keys=True, indent=2).encode()
        member = tarfile.TarInfo('release.json'); member.size = len(data); member.mode = 0o644
        stream.addfile(member, io.BytesIO(data))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(archive.suffix+'.sha256').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
    return archive


def verify(root):
    root = root.resolve()
    manifest_path = root/'release.json'
    if manifest_path.is_symlink():
        raise ValueError('Unsafe release manifest')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('database') != 'primehire_admin_v2' or not re.fullmatch(
            r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', manifest.get('version', '')):
        raise ValueError('Invalid release identity')
    actual = set()
    for file in root.rglob('*'):
        if file.is_symlink():
            raise ValueError('Release contains a symlink')
        if file.is_file():
            actual.add(file.relative_to(root).as_posix())
    if actual != set(manifest['files']) | {'release.json'}:
        raise ValueError('Release contains missing or unexpected files')
    for name, digest in manifest['files'].items():
        file = root/name
        if '\\' in name or file.is_symlink() or not file.resolve().is_relative_to(root):
            raise ValueError('Unsafe release member')
        if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
            raise ValueError(f'Release integrity check failed: {name}')
    return manifest['version']


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    cli.add_argument('--output', type=Path, default=Path('artifacts/backend'))
    cli.add_argument('--version', default=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    cli.add_argument('--verify', action='store_true')
    args = cli.parse_args()
    print(verify(args.root) if args.verify else build(args.root,args.output,args.version))
