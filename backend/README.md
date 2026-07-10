# Paradox Connect backend

## Run locally

1. Install dependencies:

   ```bash
   uv sync
   ```

2. Set the variables shown in `.env.example`. For a local MongoDB instance:

   ```bash
   export MONGODB_URI='mongodb://localhost:27017'
   export MONGODB_DATABASE='paradox_connect'
   ```

3. Start the API:

   ```bash
   uv run uvicorn app.main:app --reload
   ```

Interactive API documentation: `http://127.0.0.1:8000/docs`.

## Health endpoints

* `GET /` confirms that FastAPI is running and points to the database check.
* `GET /ping-db` returns MongoDB reachability in the starter response format.
* `GET /api/v1/health/live` confirms that FastAPI is running.
* `GET /api/v1/health/ready` confirms that MongoDB is configured and reachable.

`/live` works without MongoDB. `/ready` returns HTTP 503 until `MONGODB_URI` points to a reachable database.
