"""PrimeHire Admin CLI for operations and bootstrap (e.g. create-super-admin)."""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys

from app.config import settings
from app.db.mongodb import get_database, ping
from app.models.organization import seed_default_org, DEFAULT_ORG_ID
from app.models.user import UserRepository
from app.security.passwords import hash_password, validate_password_policy, PasswordPolicyError
from app.security.roles import Role


async def _create_super_admin(email: str, name: str, password: str, org_id: str) -> None:
    if not settings.mongodb_uri:
        print("ERROR: MONGODB_URI is not set in configuration.", file=sys.stderr)
        sys.exit(1)

    db = get_database(settings.mongodb_uri, settings.mongodb_database)
    if not await ping(db):
        print("ERROR: Could not connect to MongoDB.", file=sys.stderr)
        sys.exit(1)

    # Ensure default org exists
    await seed_default_org(db)

    try:
        validate_password_policy(password)
    except PasswordPolicyError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    user_repo = UserRepository(db)
    clean_email = email.strip().lower()
    existing = await user_repo.get_by_email(clean_email, org_id=org_id)

    pwd_hash = hash_password(password)

    if existing:
        await user_repo.update(
            existing["userId"],
            {
                "name": name,
                "role": Role.SUPER_ADMIN.value,
                "passwordHash": pwd_hash,
                "isActive": True,
            },
        )
        print(f"Successfully updated user '{clean_email}' to super_admin.")
    else:
        user = await user_repo.create({
            "email": clean_email,
            "name": name,
            "role": Role.SUPER_ADMIN.value,
            "orgId": org_id,
            "passwordHash": pwd_hash,
            "isActive": True,
        })
        print(f"Successfully created super_admin user '{clean_email}' (userId: {user['userId']}).")


def main() -> None:
    parser = argparse.ArgumentParser(description="PrimeHire administrative CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create_admin = subparsers.add_parser(
        "create-super-admin", help="Bootstrap or update a super_admin user"
    )
    create_admin.add_argument("--email", required=True, help="User email address")
    create_admin.add_argument("--name", default="Super Admin", help="User full name")
    create_admin.add_argument("--password", help="User password (prompted if omitted)")
    create_admin.add_argument(
        "--org-id", default=DEFAULT_ORG_ID, help="Organization ID (default: 'default')"
    )

    worker = subparsers.add_parser("worker", help="Run the background job worker")
    worker.add_argument("--poll-seconds", type=int, default=5, help="Idle poll interval")

    args = parser.parse_args()

    if args.command == "worker":
        from app.services.worker import run_forever

        if not settings.mongodb_uri:
            print("ERROR: MONGODB_URI is not set in configuration.", file=sys.stderr)
            sys.exit(1)
        db = get_database(settings.mongodb_uri, settings.mongodb_database)
        asyncio.run(run_forever(db, poll_seconds=args.poll_seconds))
        return

    if args.command == "create-super-admin":
        password = args.password
        if not password:
            password = getpass.getpass("Enter password for super_admin: ")
            confirm = getpass.getpass("Confirm password: ")
            if password != confirm:
                print("ERROR: Passwords do not match.", file=sys.stderr)
                sys.exit(1)

        asyncio.run(_create_super_admin(args.email, args.name, password, args.org_id))


if __name__ == "__main__":
    main()
