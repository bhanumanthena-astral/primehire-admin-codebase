"""Shim kept for existing muscle memory (`python cli.py ...`); the real
implementation lives in app.cli (`python -m app.cli`)."""

from app.cli import main

if __name__ == "__main__":
    main()
