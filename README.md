# MediconCen

NestJS and TypeScript REST API that maps each ordered pair of identifiers to a persistent UUID v4 `userID` in MySQL 8.

The API validates requests, creates UUID v4 mappings, handles concurrent inserts, and uses Redis as an optional cache. MySQL remains the permanent source of truth. [Sequence diagrams](docs/sequence.md) show the resolution and concurrency flows.

## Quick start with Docker

Docker Engine with Compose 2.20 or later can run the complete stack without installing Node.js, MySQL, or Redis on the host. Start Docker, then configure the ignored environment file:

```bash
cp .env.example .env
```

Set `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD` to distinct, nonempty passwords. Generate each value locally with `openssl rand -hex 32`, then paste it into `.env`. The root password is used only by the MySQL container; it is not passed to the API or migration container. An optional `REDIS_PASSWORD` configures the bundled Redis default user and the application's connection. Use single quotes around passwords containing `$` or `#` to preserve them during Compose interpolation. Do not commit the populated file.

```bash
docker compose up --build --detach --wait
docker compose ps --all
```

The multi-stage build compiles TypeScript and installs production dependencies separately. The final Node.js 22 image runs as the non-root `node` user and contains compiled code, production dependencies, and package metadata. Runtime credentials, tests, Git metadata, and host dependencies are excluded from the build context.

Compose starts MySQL 8.4, waits for an authenticated TCP query to succeed, and runs pending migrations in a separate container. The API starts only after migrations exit successfully. Redis 7.4 is started alongside them; Redis readiness does not gate API startup. The API healthcheck expects a `400` response to an empty identity request, checking HTTP routing and validation without creating a mapping. It does not check database readiness after startup.

The API is available at `http://localhost:3000`, or the host port selected by `PORT`. Only the API port is published, bound to `127.0.0.1`. MySQL and Redis remain on the Compose network. Container connections use `mysql:3306` and `redis:6379`; Compose overrides the local hostnames, backend ports, `NODE_ENV`, and internal API port. The bundled Redis uses the default user, so `REDIS_USERNAME` is ignored by Compose. Set `REDIS_ENABLED=false` to run the API without caching.

| Resource          | Default URL                                                        |
| ----------------- | ------------------------------------------------------------------ |
| Identity endpoint | `POST http://localhost:3000/users/resolve`                         |
| Swagger UI        | [http://localhost:3000/docs](http://localhost:3000/docs)           |
| OpenAPI JSON      | [http://localhost:3000/docs-json](http://localhost:3000/docs-json) |
| OpenAPI YAML      | [http://localhost:3000/docs-yaml](http://localhost:3000/docs-yaml) |

All URLs use the default host port. Adjust them when changing `PORT`.

Inspect application logs or rerun the compiled migrations with:

```bash
docker compose logs app migrate
docker compose run --rm migrate
```

The production image does not include the Nest CLI. The migration service therefore invokes the compiled TypeORM CLI directly; the host's `npm run migration:*` commands are for the manual setup below.

Stop the stack while preserving database records with:

```bash
docker compose down
```

MySQL data persists in a project-scoped named volume. Redis persistence is disabled and its cache rebuilds from MySQL. Database names, accounts, and passwords are initialized only when the MySQL volume is empty; editing `.env` does not change an existing database account. Change existing credentials through MySQL administration, then update `.env` and recreate the application containers.

For disposable local data only, `docker compose down --volumes` deletes the database volume and all stored mappings. This Compose setup is intended for local evaluation; production deployment needs its own secret management, network access policy, and database backup procedure.

## Run without Docker

Prerequisites:

- Node.js 22.13 or later within 22.x, or Node.js 24.11 or later, with npm.
- MySQL 8.0.18 or later within 8.x, with access to create a local database and account.
- Redis when caching is enabled; set `REDIS_ENABLED=false` for database-only operation.

The SQL below uses [MySQL-generated passwords](https://dev.mysql.com/doc/refman/8.0/en/password-management.html), available from MySQL 8.0.18.

### Set up the database

Connect to MySQL as an administrator and run:

```sql
CREATE DATABASE mediconcen
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
CREATE USER 'mediconcen'@'127.0.0.1' IDENTIFIED BY RANDOM PASSWORD;
GRANT SELECT, INSERT, DELETE, CREATE, ALTER, INDEX, DROP
  ON mediconcen.* TO 'mediconcen'@'127.0.0.1';
```

Save the returned generated password for the next step. These permissions cover local development and migrations; a deployed application account can be restricted to `SELECT` and `INSERT` after migrations are applied separately.

### Start a local Redis server

For a disposable local cache, run Redis in another terminal:

```bash
redis-server --bind 127.0.0.1 --port 6379 --protected-mode yes --save "" --appendonly no
```

This instance accepts loopback connections and disables persistence. Redis persistence is optional because the cache can be rebuilt from MySQL. To use authenticated Redis, configure its ACL credentials through `REDIS_USERNAME` and `REDIS_PASSWORD` in the ignored `.env` file. Set `REDIS_ENABLED=false` for database-only operation.

### Install and configure

```bash
npm ci
cp .env.example .env
```

Edit `.env` and set `MYSQL_PASSWORD` to the generated password. Quote the value so characters such as `#` are preserved. The example deliberately has a blank password, which fails configuration validation until supplied. `MYSQL_ROOT_PASSWORD` is required only for Compose. Keep `.env` and real credentials out of Git.

```bash
npm run migration:run
npm run migration:show
npm run start:dev
```

The migration commands compile the project before using the standalone TypeORM data source. Repeated `migration:run` calls apply only pending migrations. The database must already exist; application startup does not create or migrate tables.

For a compiled application:

```bash
npm run build
npm run start:prod
```

The default HTTP port is `3000`. A running application requires an available MySQL server and valid credentials. Apply migrations before sending requests.

## Configuration

The table describes application defaults. Compose overrides container hostnames, backend ports, `NODE_ENV`, the internal HTTP port, and the Redis username as described above.

| Variable              | Required     | Default       | Purpose                                                                                |
| --------------------- | ------------ | ------------- | -------------------------------------------------------------------------------------- |
| `NODE_ENV`            | No           | `development` | `development`, `test`, or `production`                                                 |
| `PORT`                | No           | `3000`        | HTTP listening port                                                                    |
| `MYSQL_HOST`          | Yes          | None          | Database host; local example uses `127.0.0.1`                                          |
| `MYSQL_PORT`          | No           | `3306`        | Database TCP port                                                                      |
| `MYSQL_DATABASE`      | Yes          | None          | Database name                                                                          |
| `MYSQL_USER`          | Yes          | None          | Database account                                                                       |
| `MYSQL_PASSWORD`      | Yes          | None          | Nonempty database password                                                             |
| `MYSQL_ROOT_PASSWORD` | Compose only | None          | Initializes the local MySQL container; never passed to the application                 |
| `REDIS_ENABLED`       | No           | `true`        | Enables caching; accepts `true` or `false`                                             |
| `REDIS_HOST`          | No           | `127.0.0.1`   | Redis host                                                                             |
| `REDIS_PORT`          | No           | `6379`        | Redis TCP port                                                                         |
| `REDIS_USERNAME`      | No           | Empty         | Optional ACL username, preserved without trimming                                      |
| `REDIS_PASSWORD`      | No           | Empty         | Optional password, preserved without trimming                                          |
| `REDIS_TTL_SECONDS`   | No           | `300`         | Cache lifetime in seconds, from `1` to `86400`                                         |
| `REDIS_TIMEOUT_MS`    | No           | `200`         | Connection timeout and each GET/SET local deadline in milliseconds, from `1` to `5000` |

Environment variables take precedence over `.env`. Both the application and migration CLI validate the same configuration. Invalid configuration stops startup before a connection is attempted.

## Resolve an identity

`POST /users/resolve` accepts a JSON object containing `id1` and `id2`:

```bash
curl --request POST http://localhost:3000/users/resolve \
  --header 'Content-Type: application/json' \
  --data '{"id1":"ABC123","id2":"XYZ456"}'
```

Both a new pair and an existing pair return HTTP `200` with only `userID`:

```json
{
  "userID": "550e8400-e29b-41d4-a716-446655440000"
}
```

The UUID above is illustrative. Repeat the same request to receive the same stored value. A new pair receives a UUID v4 generated with `crypto.randomUUID()` and returned only after persistence succeeds.

Both identifiers must be nonblank strings containing valid Unicode and at most 255 Unicode code points. Missing values, empty or whitespace-only strings, lone surrogates, non-string values, and extra properties are rejected. Values are neither trimmed nor coerced. Code-point counting includes variation selectors to match the database character limit.

Swagger UI at `/docs` describes the endpoint, request constraints, examples and response schemas. The same OpenAPI document is available as JSON at `/docs-json` and YAML at `/docs-yaml`.

The API has no authentication. Compose publishes it on loopback for local evaluation.

Errors use `{ statusCode, error, message }`; `message` is a string or an array of validation messages. Responses and API filter logs exclude SQL, query parameters, and underlying driver errors.

| Status | Condition                                         | Message                           |
| ------ | ------------------------------------------------- | --------------------------------- |
| `400`  | Invalid identifiers or extra properties           | Validation message array          |
| `400`  | Malformed JSON or a parser-rejected request body  | `Invalid request body`            |
| `404`  | Unknown route                                     | `Not Found`                       |
| `413`  | Request exceeds the parser limit, default `100kb` | `Payload Too Large`               |
| `415`  | Unsupported content encoding or charset           | `Unsupported Media Type`          |
| `503`  | Recognized transient database failure             | `Service temporarily unavailable` |
| `500`  | Other unexpected failure                          | `Internal server error`           |

## Data model and decisions

| Column   | Definition                        | Purpose                              |
| -------- | --------------------------------- | ------------------------------------ |
| `userID` | `CHAR(36)`, ASCII, primary key    | Stores the service-generated UUID v4 |
| `id1`    | `VARCHAR(255)`, utf8mb4, not null | Stores the first identifier          |
| `id2`    | `VARCHAR(255)`, utf8mb4, not null | Stores the second identifier         |

- Pair identity is ordered: `(A, B)` and `(B, A)` are different pairs.
- The `utf8mb4_0900_bin` collation preserves distinctions in case, leading/trailing whitespace, and Unicode normalization forms; no identifier normalization is performed.
- A composite unique index on `(id1, id2)` prevents duplicate pairs and supports pair lookup. Each pair maps to one `userID`.
- The repository uses TypeORM `insert` rather than `save`, so an existing primary key cannot be silently updated.
- Concurrent requests can both miss the initial lookup. The unique index permits one insert; on a duplicate-key error, the service rereads the pair and returns the persisted winner. An unrelated primary-key collision is rethrown if no matching pair exists. This flow uses MySQL autocommit without an explicit transaction or Redis lock.
- The application and CLI share database options. Automatic schema synchronization and migration execution on startup are disabled; schema changes use versioned migrations.
- MySQL remains the permanent source of truth; Redis stores only temporary copies of confirmed mappings.

## Cache behavior

- Reads check Redis first. A miss resolves the pair through MySQL, then caches the existing ID, successfully inserted ID, or duplicate-insert winner. Cache failures never turn a successful database result into an API failure.
- Keys use `mediconcen:identity:v1:` followed by the SHA-256 digest of `JSON.stringify([id1, id2])`, preserving pair order and identifier distinctions without ambiguous delimiters.
- Values must be lowercase canonical UUID v4 strings. Invalid values and wrong-type entries become misses and are replaced after successful database resolution. Missing records are not cached, and cache hits do not extend the TTL.
- Startup connects in the background. An error listener handles client failures, reconnection delays range from 100 to 2000 ms, offline queuing is disabled, and at most 128 commands can be pending. GET/SET failures or deadlines fall back to MySQL or skip the cache write. Shutdown destroys the client.
- With defaults, a cache miss can add a 200 ms read wait and a 200 ms write wait around database work. These are local timer deadlines; event-loop scheduling affects elapsed time. A SET already written to Redis can complete after its deadline with the confirmed database ID.
- TTL expiry, cache flushes, and Redis restart loss do not change MySQL IDs. During a MySQL outage, cache hits can serve previously stored mappings until expiration; uncached requests return `503` for recognized transient database failures.

Mappings are immutable through this API: there are no update or delete endpoints. The cache namespace must be trusted; UUID shape validation cannot detect a wrong but valid UUID. After manual database changes or restores, invalidate only the application's `mediconcen:identity:v1:*` namespace before serving requests to avoid stale mappings.

## Project structure

| File                                                                   | Responsibility                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/main.ts`                                                          | Bootstraps NestJS and enables shutdown hooks                                                     |
| `src/app.module.ts`                                                    | Wires modules and global `APP_PIPE`/`APP_FILTER` providers                                       |
| `src/config/environment.ts`                                            | Validates and types environment configuration                                                    |
| `src/cache/cache.module.ts`                                            | Registers and exports the identity cache                                                         |
| `src/cache/identity-cache.service.ts`                                  | Manages Redis lifecycle, cache keys, validation, TTL, and fallback                               |
| `src/database/database.options.ts`                                     | Defines shared TypeORM connection and schema options                                             |
| `src/database/database.module.ts`                                      | Configures the NestJS database connection                                                        |
| `src/database/data-source.ts`                                          | Exports the standalone migration data source                                                     |
| `src/database/database-errors.ts`                                      | Classifies duplicate-key and transient database errors                                           |
| `src/database/migrations/1794096000000-create-identity-mappings.ts`    | Creates and removes the identity table                                                           |
| `src/identity/identity.entity.ts`                                      | Maps identity columns and the composite unique index                                             |
| `src/identity/identity.controller.ts`                                  | Exposes `POST /users/resolve`                                                                    |
| `src/identity/identity.service.ts`                                     | Resolves pairs through cache/MySQL, generates UUIDs, and recovers duplicate inserts              |
| `src/identity/dto/`                                                    | Defines request validation and code-point length checking                                        |
| `src/identity/dto/resolved-identity.dto.ts`                            | Documents the UUID response schema                                                               |
| `src/identity/identity.repository.ts`                                  | Looks up pairs and inserts mappings                                                              |
| `src/common/pipes/request-validation.pipe.ts`                          | Configures strict global request validation                                                      |
| `src/common/filters/api-exception.filter.ts`                           | Returns consistent API errors and generic server logs                                            |
| `src/common/dto/api-error.dto.ts`                                      | Documents the shared API error shape                                                             |
| `src/documentation/swagger.ts`                                         | Generates OpenAPI and serves Swagger UI, JSON and YAML                                           |
| `test/unit/`                                                           | Tests services, validation, configuration, caching, and error handling without external services |
| `test/unit/openapi.spec.ts`                                            | Checks published schemas, documentation routes and response examples                             |
| `test/integration/identity.integration.spec.ts`                        | Tests HTTP requests, migrations, persistence, concurrency, and caching with real backends        |
| `test/helpers/`                                                        | Validates test configuration and manages isolated integration resources                          |
| `jest.config.cjs`, `jest.integration.config.cjs`, `test/tsconfig.json` | Configures unit/integration discovery, TypeScript transformation, and coverage                   |
| `Dockerfile`, `.dockerignore`                                          | Builds a non-root production image without local configuration or development dependencies       |
| `compose.yaml`                                                         | Runs the API, migration job, MySQL 8.4, and Redis 7.4 for local evaluation                       |
| `docs/sequence.md`                                                     | Shows validation, cache/database resolution and concurrent-insert recovery                       |

## Development checks

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
```

## Run tests

| Command                    | Scope                                        | Services required |
| -------------------------- | -------------------------------------------- | ----------------- |
| `npm test`                 | Unit tests                                   | None              |
| `npm run test:cov`         | Unit tests with coverage in `coverage/unit/` | None              |
| `npm run test:integration` | Integration tests                            | MySQL 8 and Redis |
| `npm run test:all`         | Unit tests followed by integration tests     | MySQL 8 and Redis |

Unit coverage excludes application bootstrap, the migration CLI data source, and migration files. The integration suite applies migrations to a fresh database and checks the resulting schema. Jest is configured without Watchman.

### Configure integration tests

Use a dedicated, empty database and a database-scoped test account. Connect to MySQL as an administrator and run:

```sql
CREATE DATABASE mediconcen_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
CREATE USER 'mediconcen_test'@'127.0.0.1' IDENTIFIED BY RANDOM PASSWORD;
GRANT SELECT, INSERT, DELETE, CREATE, ALTER, INDEX, DROP
  ON `mediconcen\_test`.* TO 'mediconcen_test'@'127.0.0.1';
```

The escaped underscore in the grant keeps the database scope literal. Save the generated password, then create the ignored test configuration:

```bash
cp .env.test.example .env.test
```

Set `TEST_MYSQL_PASSWORD` to that password. `TEST_MYSQL_DATABASE`, `TEST_MYSQL_USER`, and `TEST_MYSQL_PASSWORD` are required; application `MYSQL_*` credentials are never used as fallbacks. The database name must be `mediconcen_test` or `mediconcen_test_<suffix>`, with lowercase letters/digits in suffix components, optional separating underscores, and a maximum of 64 characters.

`TEST_MYSQL_HOST` and `TEST_MYSQL_PORT` default to `127.0.0.1:3306`. `TEST_REDIS_HOST` and `TEST_REDIS_PORT` default to `127.0.0.1:6379`; `TEST_REDIS_USERNAME` and `TEST_REDIS_PASSWORD` are optional and default to empty strings. Start both services before running:

```bash
npm run test:integration
```

The fixture holds a MySQL named lock and refuses a nonempty database. It applies migrations and, during cleanup, drops only its `identity_mappings` and `migrations` tables. The account therefore needs the scoped DDL permissions shown above. Redis tests use database 0 and delete only tracked, run-specific cache keys; they do not flush Redis or stop either server. Missing configuration or unavailable services fail the suite rather than silently skipping it.

Verification snapshot on 2026-11-08: 133 unit tests across 8 suites and 37 integration tests passed. Container verification used Node.js 22.23.4, MySQL 8.4.13, Redis 7.4.12 and Compose 5.3.1. Cold startup, idempotent migrations, 16 concurrent first requests, Redis unavailability, database-only operation and persistence across a full container restart with the volume retained passed. Integration checks also passed previously against MySQL 8.0.46 and Redis 7.4.12 with Jest's `--detectOpenHandles` option.

The compiled Docker application served all three documentation routes, and Swagger UI's request example returned HTTP `200`. The JSON and YAML specifications passed OpenAPI 3.0 validation and matched each other. Both sequence diagrams were rendered and visually checked.

HTTP database-error scenarios inject repository failures; they do not stop a database server or establish behavior during a server-wide outage. Cache UUID validation checks shape, not provenance; a trusted cache namespace is part of the configuration contract.

## Revert a local migration

```bash
npm run migration:revert
```

This reverts the most recent migration. Reverting the initial migration drops `identity_mappings` and permanently deletes its rows. Use this only for disposable local data. MySQL DDL implicitly commits, so migration failures cannot be assumed to roll back atomically.
