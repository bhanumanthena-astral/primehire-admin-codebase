"""Export independent frontend source and a ready-to-upload Pages ZIP. No user data."""
import hashlib
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT/'frontend'
OUTPUT = ROOT/'artifacts/frontend'


def write_zip(name, files, base):
    destination = OUTPUT/name
    if destination.exists():
        raise RuntimeError('Archive exists; choose a fresh version.')
    with zipfile.ZipFile(destination,'x',compression=zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(files):
            if file.is_symlink() or not file.resolve().is_relative_to(base.resolve()):
                raise ValueError('Unsafe frontend source path')
            archive.write(file,file.relative_to(base).as_posix())
    digest=hashlib.sha256(destination.read_bytes()).hexdigest()
    destination.with_suffix('.zip.sha256').write_text(digest+'  '+name+'\n',encoding='utf-8')
    return destination


def source_files():
    """Select standalone source, including public assets, without private files."""
    source=[]
    top={'package.json','package-lock.json','index.html','tsconfig.json','vite.config.ts',
         'vitest.config.ts','components.json','metadata.json','README.md','.env.example','.gitignore','wrangler.toml'}
    for name in top:source.append(FRONT/name)
    for name in ['.nvmrc','AGENTS.md','.gitattributes']:
        if (FRONT/name).is_file():source.append(FRONT/name)
    for directory in ['src','components','lib','cloudflare','scripts','public','.github']:
        for file in (FRONT/directory).rglob('*'):
            if file.is_symlink():raise ValueError('Symlinks cannot be exported')
            if file.is_file():
                if file.name.startswith('.env') or file.suffix not in {
                    '.ts','.tsx','.js','.mjs','.css','.json','.svg','.md','.yml','.yaml',
                    '.png','.jpg','.jpeg','.webp','.ico','.avif','.woff','.woff2'}:
                    raise ValueError('Unexpected frontend source file type')
                source.append(file)
    return source


def build(version):
    import re
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}',version):
        raise ValueError('Unsafe version')
    OUTPUT.mkdir(exist_ok=True,parents=True)
    source=source_files()
    dist=FRONT/'dist'
    for required in ['index.html','_worker.js','_routes.json','_headers']:
        if not (dist/required).is_file():raise ValueError('Build the Pages frontend first')
    deploy=[file for file in dist.rglob('*') if file.is_file()]
    if any(file.name.startswith('.env') or file.name.endswith('.map') for file in deploy):
        raise ValueError('Private configuration/source maps must not ship')
    if len(deploy)>1000 or any(file.stat().st_size>25*1024**2 for file in deploy):
        raise ValueError('Output exceeds Cloudflare dashboard upload limits')
    return [write_zip(f'elitehr-frontend-source-{version}.zip',source,FRONT),
            write_zip(f'elitehr-cloudflare-{version}.zip',deploy,dist)]


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version',required=True)
    for archive in build(parser.parse_args().version):print(archive.relative_to(ROOT))
