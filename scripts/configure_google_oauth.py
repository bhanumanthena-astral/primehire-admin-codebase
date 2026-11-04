"""Read a private Google Web client JSON into backend/.env without echoing secrets."""
import argparse
import json
import sys
from pathlib import Path
from cryptography.fernet import Fernet
from dotenv import dotenv_values, set_key

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client-json', type=Path, required=True)
    parser.add_argument('--redirect-uri', required=True)
    parser.add_argument('--confirm-registered-redirect', action='store_true',
                        help='Confirm that this exact URI was saved in Google Cloud after the JSON was downloaded.')
    args = parser.parse_args()
    try:
        web = json.loads(args.client_json.read_text(encoding='utf-8'))['web']
        if args.redirect_uri not in web.get('redirect_uris', []) and not args.confirm_registered_redirect:
            raise ValueError('Register the exact redirect URI in the Google Web client and download its JSON again.')
        path = ROOT / 'backend' / '.env'
        current = dotenv_values(path)
        values = {'GOOGLE_CLIENT_ID': web['client_id'], 'GOOGLE_CLIENT_SECRET': web['client_secret'],
                  'GOOGLE_REDIRECT_URI': args.redirect_uri, 'GOOGLE_LOGIN_ORG_ID': current.get('GOOGLE_LOGIN_ORG_ID') or 'default',
                  'GOOGLE_TOKEN_ENCRYPTION_KEY': current.get('GOOGLE_TOKEN_ENCRYPTION_KEY') or Fernet.generate_key().decode(),
                  'GOOGLE_CALENDAR_DAILY_LIMIT': current.get('GOOGLE_CALENDAR_DAILY_LIMIT') or '10000', 'GOOGLE_OAUTH_ENABLED': 'true'}
        from app.config import Settings, validate_settings
        candidate = Settings(_env_file=path, **{key.lower(): value for key, value in values.items()})
        validate_settings(candidate)
        for key, value in values.items():
            set_key(str(path), key, str(value))
        print('Google OAuth configured in backend/.env. Restart the V2 API and recruitment worker. No billing or Cloud configuration changed.')
    except (OSError, KeyError, ValueError, RuntimeError):
        # Validation exceptions can contain supplied secrets; never print them.
        raise SystemExit('Google OAuth configuration was not applied. Check the Web client JSON, registered redirect URI and V2 backend settings.') from None


if __name__ == '__main__':
    main()
