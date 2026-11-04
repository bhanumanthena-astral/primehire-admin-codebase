"""Check source/Git hygiene without printing credential values or source excerpts."""
import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_DIRS = {'.git', 'node_modules', '.venv', '.venv-v2', '__pycache__', '.pytest_cache',
                'dist', 'coverage', 'htmlcov', 'artifacts', '.tmp', 'scratch', 'test-results',
                'playwright-report'}
TOKEN_PATTERNS = {
    'google_oauth_secret': re.compile(r'GOCSPX-[A-Za-z0-9_-]{16,}'),
    'google_api_key': re.compile(r'AIza[A-Za-z0-9_-]{30,}'),
    'openrouter_key': re.compile(r'sk-or-v1-[A-Za-z0-9]{32,}'),
    'private_key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
}
ASSIGNMENT = re.compile(
    r'''(?:x-access-key|x-secret-key|PRIMEHIRE_ACCESS_KEY|PRIMEHIRE_SECRET_KEY|GOOGLE_CLIENT_SECRET|OPENROUTER_API_KEY)\s*['"]?\s*[:=]\s*['"]([^'"\r\n]{16,})['"]''', re.I)
SYNTHETIC = re.compile(r'^(?:synthetic|placeholder|example|replace|test[-_ ]|fake|mock|your[-_ ]|do[-_ ]not[-_ ]use|__TRANSFER)', re.I)


def private_path(name):
    path = Path(name)
    return (any(part in PRIVATE_DIRS for part in path.parts)
            or any(name.startswith(prefix) for prefix in ['backend/secrets/', 'backend/storage/', 'backend/runtime/', 'backend/logs/', 'backend/tools/'])
            or (path.name.startswith('.env') and path.name != '.env.example')
            or path.name.startswith('client_secret') or path.suffix in {'.log', '.pyc', '.pyo'}
            or path.name in {'tunnel_url.txt', 'v2-admin-invite.txt', '.coverage'})


def configured_secrets():
    """Optional local exact-value check; CI uses static checks without runtime secrets."""
    try:
        from dotenv import dotenv_values
    except ImportError:
        return {}
    result = {}
    for name in ['.env', '.env.local', 'backend/.env']:
        for key, value in dotenv_values(ROOT / name).items():
            if (value and len(value) >= 16 and re.search(r'SECRET|PASSWORD|TOKEN|(?:^|_)KEY$', key)
                    and not SYNTHETIC.search(value)):
                result[value] = key
    return result


def findings_for(name, data, secrets):
    findings = []
    if private_path(name):
        findings.append({'path': name, 'rule': 'private_or_generated_file'})
        return findings
    text = data.decode('utf-8', errors='replace')
    for label, pattern in TOKEN_PATTERNS.items():
        if pattern.search(text):
            findings.append({'path': name, 'rule': label})
    if any(not SYNTHETIC.search(match.group(1)) for match in ASSIGNMENT.finditer(text)):
        findings.append({'path': name, 'rule': 'embedded_provider_credential'})
    for value, key in secrets.items():
        if value in text:
            findings.append({'path': name, 'rule': 'configured_secret_in_source', 'setting': key})
    return findings


def audit(index=False):
    args = ['git', 'ls-files', '-z'] + ([] if index else ['--cached', '--others', '--exclude-standard'])
    names = set(subprocess.check_output(args, cwd=ROOT).decode().strip('\0').split('\0')) - {''}
    findings, count = [], 0
    secrets = configured_secrets()
    for name in sorted(names):
        path = ROOT / name
        if not index and not path.is_file():
            continue  # Includes the previously removed root frontend duplicates.
        if index:
            data = subprocess.check_output(['git', 'show', ':' + name], cwd=ROOT, stderr=subprocess.DEVNULL)
        else:
            if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
                findings.append({'path': name, 'rule': 'source_symlink'})
                continue
            data = path.read_bytes()
        count += 1
        findings.extend(findings_for(name, data, secrets))
    return {'mode': 'git_index' if index else 'working_source', 'filesChecked': count, 'findings': findings}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', action='store_true', help='Inspect the exact staged Git blobs, including files already ignored.')
    result = audit(parser.parse_args().index)
    print(json.dumps(result, indent=2))
    raise SystemExit(1 if result['findings'] else 0)
