"""Load root-only configuration, then check dependencies as the service user."""
import os
import sys

from dotenv import dotenv_values


def main(env_file='/etc/elitehr/backend.env'):
    import pwd

    if os.geteuid() != 0:
        raise RuntimeError('Deployment preflight must start as root')
    values = dotenv_values(env_file)
    if not values:
        raise RuntimeError('Deployment environment is missing or empty')
    account = pwd.getpwnam('elitehr')
    os.environ.update({key: value for key, value in values.items() if value is not None})
    os.initgroups(account.pw_name, account.pw_gid)
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
    os.execv(sys.executable, [sys.executable, '-m', 'deploy.runtime', 'check'])


if __name__ == '__main__':
    main()
