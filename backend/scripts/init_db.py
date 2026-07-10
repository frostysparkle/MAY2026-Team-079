import asyncio

from dotenv import load_dotenv


load_dotenv()

from app.core.config import get_settings  # noqa: E402
from app.db.bootstrap import initialize_database  # noqa: E402
from app.db.mongo import MongoService  # noqa: E402


async def _initialize() -> None:
    settings = get_settings()
    if settings.mongodb_uri is None:
        raise RuntimeError("MONGODB_URI is not set. Add it to backend/.env first.")

    mongo = MongoService(settings)
    mongo.connect()

    try:
        if not await mongo.ping():
            raise RuntimeError("MongoDB is not reachable. Check the URI and Atlas access.")

        result = await initialize_database(mongo.database, settings)
    finally:
        await mongo.close()

    print(f"Initialized database: {settings.mongodb_database}")
    print(f"Collections: {', '.join(result.collections)}")
    if result.super_admin_email is not None:
        action = "created" if result.super_admin_created else "already existed"
        print(f"Super Admin invitation '{result.super_admin_email}' {action}.")
    else:
        print("No initial Super Admin configured.")
    if result.legacy_password_users:
        print(
            f"Warning: {result.legacy_password_users} legacy password user(s) remain. "
            "They cannot sign in unless linked to a verified Google account."
        )


def main() -> None:
    asyncio.run(_initialize())


if __name__ == "__main__":
    main()
