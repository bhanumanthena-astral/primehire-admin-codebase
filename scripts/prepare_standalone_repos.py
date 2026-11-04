"""Prepare two independent source folders without moving the working application."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = Path(__file__).with_name('repository_templates')
BACKEND_ONLY_EXCLUSIONS = {'test_frontend_release.py', 'test_standalone_repos.py'}


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def checked(file, root):
    if file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):
        raise ValueError('Source paths must stay inside the project without symlinks')
    if not file.is_file():
        raise ValueError(f'Required source missing: {file.relative_to(root)}')
    return file


def backend_files(root):
    base = root / 'backend'
    files = [base / name for name in ['requirements.txt', 'requirements-production.txt',
                                      'pytest.ini', 'cli.py', '.env.example']]
    for directory in ['app', 'migrations', 'deploy', 'tests']:
        for file in (base / directory).rglob('*'):
            if file.is_symlink():
                raise ValueError('Backend symlinks cannot be exported')
            if not file.is_file() or '__pycache__' in file.parts:
                continue
            if directory == 'tests' and file.name in BACKEND_ONLY_EXCLUSIONS:
                continue  # These test monorepo export tooling, not backend behavior.
            allowed = {'.py'} if directory != 'deploy' else {
                '.py', '.sh', '.service', '.timer', '.slice', '.example', '.md'}
            if file.suffix in allowed:
                files.append(file)
    for file in (root / 'scripts').glob('*.py'):
        if file.name not in {'build_frontend_release.py', 'prepare_standalone_repos.py',
                             'make_jobs_browser_fixture.py'}:
            files.append(file)
    return [checked(file, root) for file in files]


def write(root, relative, data):
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def build(root, output, version):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', version):
        raise ValueError('Unsafe version')
    root, output = root.resolve(), output.resolve()
    destination = output / version
    if destination.exists():
        raise ValueError('Repository snapshot exists; use a fresh version')
    # Select and validate everything before creating output. No broad directory copies.
    frontend = module('build_frontend_release')
    frontend.FRONT = root / 'frontend'
    front_files = [checked(file, root / 'frontend') for file in frontend.source_files()]
    back_files = backend_files(root)
    front = destination / 'elitehr-frontend'
    back = destination / 'elitehr-backend'
    for file in front_files:
        write(front, file.relative_to(root / 'frontend'), file.read_bytes())
    for file in back_files:
        write(back, file.relative_to(root), file.read_bytes())
    for file in (root / 'docs').glob('*.md'):
        checked(file, root)
        write(back, Path('docs') / file.name, file.read_bytes())
    for name in ['REVIEW_SUBMISSION_SUCCESS.md', 'APPLE_DESIGN_SYSTEM.md', 'SEPARATE_REPOSITORIES.md']:
        file = root / 'docs' / name
        if file.is_file():
            write(front, Path('docs') / name, checked(file, root).read_bytes())
    for source, target in [
        ('backend-README.md', 'README.md'), ('backend-AGENTS.md', 'AGENTS.md'),
        ('backend-ci.yml', '.github/workflows/ci.yml'), ('backend-pytest.ini', 'pytest.ini'),
        ('backend.gitignore', '.gitignore'), ('gitattributes', '.gitattributes')]:
        write(back, target, (TEMPLATES / source).read_bytes())
    write(front, 'AGENTS.md', (TEMPLATES / 'frontend-AGENTS.md').read_bytes())
    write(front, '.gitattributes', (TEMPLATES / 'gitattributes').read_bytes())
    # Run the existing source scanner, including exact local-secret matching, before ZIPs.
    audit = module('audit_repository')
    secrets = audit.configured_secrets()
    manifest = {'version': version, 'repositories': {}, 'excludedBackendTests': sorted(BACKEND_ONLY_EXCLUSIONS)}
    for repo in [front, back]:
        entries = {}
        for file in sorted(repo.rglob('*')):
            if not file.is_file():
                continue
            name = file.relative_to(repo).as_posix()
            if audit.findings_for(name, file.read_bytes(), secrets):
                raise ValueError(f'Source safety check failed: {repo.name}/{name}')
            entries[name] = hashlib.sha256(file.read_bytes()).hexdigest()
        archive = destination / (repo.name + '.zip')
        with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED) as stream:
            for name in entries:
                stream.write(repo / name, name)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        archive.with_suffix('.zip.sha256').write_text(digest + '  ' + archive.name + '\n', encoding='utf-8')
        manifest['repositories'][repo.name] = {'files': entries, 'archiveSha256': digest}
    write(destination, 'manifest.json', (json.dumps(manifest, indent=2) + '\n').encode())
    return destination


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--version', required=True)
    cli.add_argument('--output', type=Path, default=ROOT / 'artifacts/repositories')
    args = cli.parse_args()
    print(build(ROOT, args.output, args.version))
