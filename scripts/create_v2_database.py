"""Create a fresh V2 database without reading or changing V1 collections."""
from pathlib import Path
from datetime import datetime, timezone

from dotenv import dotenv_values
from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
TARGET = "primehire_admin_v2"


def main():
    configuration = dotenv_values(ROOT / "backend" / ".env")
    source = configuration.get("MONGODB_DATABASE") or "primehire"
    uri = configuration.get("MONGODB_URI")
    if not uri or source == TARGET:
        raise SystemExit("Expected the original database configuration and a MongoDB URI.")
    with MongoClient(uri, serverSelectionTimeoutMS=10000) as client:
        database = client[TARGET]
        # Do not initialize or overwrite a database that already contains data.
        if database.list_collection_names():
            raise SystemExit("V2 database already contains collections; no changes made.")
        database["v2_setup"].insert_one({
            "purpose": "Fresh Prime Hire V2 database; no V1 data copied",
            "createdAt": datetime.now(timezone.utc),
        })
        print(f"Created {TARGET}. Original database was not accessed.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Driver exceptions can contain connection details; never print them.
        raise SystemExit(f"Database creation failed ({type(error).__name__}); configuration unchanged.") from None
