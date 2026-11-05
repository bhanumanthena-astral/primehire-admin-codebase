import sys
from types import SimpleNamespace

from deploy.e2e import preflight


def test_private_environment_is_loaded_before_dropping_privileges(tmp_path, monkeypatch):
    environment = tmp_path / 'backend.env'
    environment.write_text('POSTGRES_URL=synthetic-private-dsn\n')
    events = []
    monkeypatch.setitem(sys.modules, 'pwd', SimpleNamespace(getpwnam=lambda _: SimpleNamespace(pw_name='elitehr', pw_gid=2000, pw_uid=2000)))
    monkeypatch.setattr(preflight.os, 'geteuid', lambda: 0, raising=False)
    monkeypatch.setattr(preflight.os, 'environ', {})
    monkeypatch.setattr(preflight.os, 'initgroups', lambda *args: events.append('groups'), raising=False)
    monkeypatch.setattr(preflight.os, 'setgid', lambda _: events.append('gid'), raising=False)
    monkeypatch.setattr(preflight.os, 'setuid', lambda _: events.append('uid'), raising=False)
    monkeypatch.setattr(preflight.os, 'execv', lambda exe, args: events.append((preflight.os.environ['POSTGRES_URL'], args)))
    preflight.main(environment)
    assert events[:3] == ['groups', 'gid', 'uid']
    assert events[3][0] == 'synthetic-private-dsn'
    assert events[3][1][-3:] == ['-m', 'deploy.runtime', 'check']
