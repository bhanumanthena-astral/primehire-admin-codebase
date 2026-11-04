"""Source-only repository boundaries, with no live database or cloud operations."""
import hashlib
import importlib.util
import json
from pathlib import Path
import zipfile

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def exporter():
    spec = importlib.util.spec_from_file_location('standalone_repos', ROOT / 'scripts/prepare_standalone_repos.py')
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def test_independent_repositories_preserve_assets_and_exclude_data(exporter, tmp_path):
    destination = exporter.build(ROOT, tmp_path, 'test-01')
    front, back = destination / 'elitehr-frontend', destination / 'elitehr-backend'
    assert (front / 'public/images/interview-review-thank-you.png').read_bytes() == (
        ROOT / 'frontend/public/images/interview-review-thank-you.png').read_bytes()
    assert (front / 'package-lock.json').is_file()
    assert (front / '.github/workflows/ci.yml').is_file()
    assert (back / 'backend/app/main.py').is_file()
    assert (back / 'backend/deploy/build_release.py').is_file()
    assert (back / 'scripts/configure_google_oauth.py').is_file()
    assert not (back / 'backend/tests/test_frontend_release.py').exists()
    assert not (back / 'backend/tests/test_standalone_repos.py').exists()
    assert 'pythonpath = backend' in (back / 'pytest.ini').read_text()
    assert not (back / 'package.json').exists()
    manifest = json.loads((destination / 'manifest.json').read_text())
    for repo in [front, back]:
        names = manifest['repositories'][repo.name]['files']
        assert not any(any(part in {'.git','node_modules','storage','secrets','.venv','.venv-v2',
            '__pycache__','dist','runtime','logs'} for part in Path(name).parts) for name in names)
        assert not any(Path(name).name.startswith('.env') and Path(name).name != '.env.example' for name in names)
        assert not any(name.startswith('backend/' if repo == front else 'frontend/') for name in names)
        with zipfile.ZipFile(destination / (repo.name + '.zip')) as archive:
            assert set(archive.namelist()) == set(names)
            for name, digest in names.items():
                assert hashlib.sha256(archive.read(name)).hexdigest() == digest
    with pytest.raises(ValueError, match='snapshot exists'):
        exporter.build(ROOT, tmp_path, 'test-01')


@pytest.mark.parametrize('version', ['../escape', 'x/y', '', 'a' * 81])
def test_version_cannot_escape_output(exporter, tmp_path, version):
    with pytest.raises(ValueError, match='Unsafe version'):
        exporter.build(ROOT, tmp_path, version)
    assert not list(tmp_path.iterdir())


def test_symlink_source_is_rejected_before_copying(exporter, tmp_path):
    source = tmp_path / 'source'
    source.mkdir()
    outside = tmp_path / 'outside.py'
    outside.write_text('synthetic')
    link = source / 'linked.py'
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip('Creating symlinks requires Windows developer permissions')
    with pytest.raises(ValueError, match='without symlinks'):
        exporter.checked(link, source)
