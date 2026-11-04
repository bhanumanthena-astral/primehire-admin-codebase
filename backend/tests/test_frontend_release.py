"""Frontend export boundaries; no app integrations or database access."""
import importlib.util
from pathlib import Path
import zipfile
import pytest


@pytest.fixture
def exporter(tmp_path,monkeypatch):
    path=Path(__file__).resolve().parents[2]/'scripts/build_frontend_release.py'
    spec=importlib.util.spec_from_file_location('frontend_release',path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module,'ROOT',tmp_path)
    front=tmp_path/'frontend';front.mkdir()
    monkeypatch.setattr(module,'FRONT',front)
    monkeypatch.setattr(module,'OUTPUT',tmp_path/'artifacts')
    for name in ['package.json','package-lock.json','index.html','tsconfig.json','vite.config.ts',
        'vitest.config.ts','components.json','metadata.json','README.md','.env.example','.gitignore','wrangler.toml']:
        (front/name).write_text('synthetic',encoding='utf-8')
    for folder in ['src','components','lib','cloudflare','scripts']:
        (front/folder).mkdir()
        (front/folder/'synthetic.ts').write_text('synthetic',encoding='utf-8')
    (front/'public/images').mkdir(parents=True)
    (front/'public/images/thank-you.png').write_bytes(b'synthetic-image')
    (front/'dist').mkdir()
    for name in ['index.html','_worker.js','_routes.json','_headers']:
        (front/'dist'/name).write_text('synthetic',encoding='utf-8')
    (front/'.env').write_text('DO_NOT_EXPORT',encoding='utf-8')
    (front/'node_modules').mkdir()
    (front/'node_modules/private.js').write_text('DO_NOT_EXPORT',encoding='utf-8')
    (tmp_path/'backend').mkdir()
    (tmp_path/'backend/private.env').write_text('DO_NOT_EXPORT',encoding='utf-8')
    return module


def test_independent_frontend_archives_exclude_backend_secrets_and_dependencies(exporter):
    source,deploy=exporter.build('test-01')
    with zipfile.ZipFile(source) as archive:
        assert 'package-lock.json' in archive.namelist()
        assert '.env.example' in archive.namelist()
        assert 'public/images/thank-you.png' in archive.namelist()
        assert all('DO_NOT_EXPORT' not in archive.read(name).decode() for name in archive.namelist())
        assert not any(name.startswith(('backend/','node_modules/','dist/')) for name in archive.namelist())
    with zipfile.ZipFile(deploy) as archive:
        assert set(archive.namelist()) == {'index.html','_worker.js','_routes.json','_headers'}
    assert source.with_suffix('.zip.sha256').exists()


def test_frontend_export_refuses_private_deployment_files_and_version_traversal(exporter):
    with pytest.raises(ValueError):exporter.build('../../outside')
    (exporter.FRONT/'dist/.env').write_text('private',encoding='utf-8')
    with pytest.raises(ValueError,match='Private configuration'):exporter.build('test-02')
