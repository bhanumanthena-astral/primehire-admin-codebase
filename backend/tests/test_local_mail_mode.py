"""Local live-mail mode must never authorize a wider recipient set."""
from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path
from types import SimpleNamespace

spec=spec_from_file_location('local_mail_check',Path(__file__).resolve().parents[2]/'scripts/verify_e2e_connection.py')
module=module_from_spec(spec)
spec.loader.exec_module(module)

def settings(**changes):
    return SimpleNamespace(**{'email_dry_run':False,'recruitment_email_dry_run':False,'test_recipient_allowlist':['test@example.test'],'recruitment_email_test_recipient_allowlist':'test@example.test',**changes})

def test_normal_dry_run_and_explicit_single_recipient():
    assert module.mail_mode_allowed(settings(email_dry_run=True,recruitment_email_dry_run=True),'')
    assert module.mail_mode_allowed(settings(),'test@example.test')

def test_live_mode_rejects_missing_marker_broad_allowlist_and_partial_modes():
    assert not module.mail_mode_allowed(settings(),'')
    assert not module.mail_mode_allowed(settings(test_recipient_allowlist=['@example.test']),'test@example.test')
    assert not module.mail_mode_allowed(settings(recruitment_email_test_recipient_allowlist='test@example.test,other@example.test'),'test@example.test')
    assert not module.mail_mode_allowed(settings(email_dry_run=True),'test@example.test')
    assert not module.mail_mode_allowed(settings(recruitment_email_dry_run=True),'test@example.test')
