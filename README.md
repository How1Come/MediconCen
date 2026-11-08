# MediconCen

NestJS and TypeScript project for resolving an ordered pair of identifiers to a persistent user ID in MySQL.

The current stage provides a validated POST endpoint, UUID v4 generation, MySQL persistence, duplicate-request handling, and Redis caching. A reusable automated test suite, Docker packaging, and OpenAPI documentation are scheduled for later stages.

## Prerequisites

- Node.js 22.13 or later within 22.x, or Node.js 24.11 or later, with npm.
- MySQL 8.0.18 or later within 8.x, with access to create a local database and account.
- Redis for caching; the application also runs with Redis unavailable or explicitly disabled.

The setup below uses [MySQL-generated passwords](https://dev.mysql.com/doc/refman/8.0/en/password-management.html), available from 8.0.18. Persistence checks were run against MySQL 8.0.46.

## Set up the database

Connect to MySQL as an administrator and run:

```sql
CREATE DATABASE mediconcen
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
CREATE USER 'mediconcen'@'127.0.0.1' IDENTIFIED BY RANDOM PASSWORD;
GRANT SELECT, INSERT, DELETE, CREATE, ALTER, INDEX, DROP
  ON mediconcen.* TO 'mediconcen'@'127.0.0.1';
```

Save the returned generated password for the next step. These permissions cover local development and migrations; a deployed application account can be restricted to `SELECT` and `INSERT` after migrations are applied separately.

## Start a local Redis server

For a disposable local cache, run Redis in another terminal:

```bash
redis-server --bind 127.0.0.1 --port 6379 --protected-mode yes --save "" --appendonly no
```

This instance accepts loopback connections and disables persistence. Redis persistence is optional because the cache can be rebuilt from MySQL. To use authenticated Redis, configure its ACL credentials through `REDIS_USERNAME` and `REDIS_PASSWORD` in the ignored `.env` file. Set `REDIS_ENABLED=false` for database-only operation.

## Install and configure

```bash
npm ci
cp .env.example .env
```

Edit `.env` and set `MYSQL_PASSWORD` to the generated password. Quote the value so characters such as `#` are preserved. The example deliberately has a blank password, which fails configuration validation until supplied. Keep `.env` and real credentials out of Git.

| Variable            | Required | Default       | Purpose                                                                                |
| ------------------- | -------- | ------------- | -------------------------------------------------------------------------------------- |
| `NODE_ENV`          | No       | `development` | `development`, `test`, or `production`                                                 |
| `PORT`              | No       | `3000`        | HTTP listening port                                                                    |
| `MYSQL_HOST`        | Yes      | None          | Database host; local example uses `127.0.0.1`                                          |
| `MYSQL_PORT`        | No       | `3306`        | Database TCP port                                                                      |
| `MYSQL_DATABASE`    | Yes      | None          | Database name                                                                          |
| `MYSQL_USER`        | Yes      | None          | Database account                                                                       |
| `MYSQL_PASSWORD`    | Yes      | None          | Nonempty database password                                                             |
| `REDIS_ENABLED`     | No       | `true`        | Enables caching; accepts `true` or `false`                                             |
| `REDIS_HOST`        | No       | `127.0.0.1`   | Redis host                                                                             |
| `REDIS_PORT`        | No       | `6379`        | Redis TCP port                                                                         |
| `REDIS_USERNAME`    | No       | Empty         | Optional ACL username, preserved without trimming                                      |
| `REDIS_PASSWORD`    | No       | Empty         | Optional password, preserved without trimming                                          |
| `REDIS_TTL_SECONDS` | No       | `300`         | Cache lifetime in seconds, from `1` to `86400`                                         |
| `REDIS_TIMEOUT_MS`  | No       | `200`         | Connection timeout and each GET/SET local deadline in milliseconds, from `1` to `5000` |

Environment variables take precedence over `.env`. Both the application and migration CLI validate the same configuration. Invalid configuration stops startup before a connection is attempted.

## Apply migrations and start

```bash
npm run migration:run
npm run migration:show
npm run start:dev
```

The migration commands compile the project before using the standalone TypeORM data source. Repeated `migration:run` calls apply only pending migrations. The database must already exist.

For a compiled application:

```bash
npm run build
npm run start:prod
```

The default port is `3000`. A running application requires an available MySQL server and valid credentials. Apply migrations before sending requests; startup does not check or create the table.

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

| File                                                                | Responsibility                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/main.ts`                                                       | Bootstraps NestJS and enables shutdown hooks                                        |
| `src/app.module.ts`                                                 | Wires modules and global `APP_PIPE`/`APP_FILTER` providers                          |
| `src/config/environment.ts`                                         | Validates and types environment configuration                                       |
| `src/cache/cache.module.ts`                                         | Registers and exports the identity cache                                            |
| `src/cache/identity-cache.service.ts`                               | Manages Redis lifecycle, cache keys, validation, TTL, and fallback                  |
| `src/database/database.options.ts`                                  | Defines shared TypeORM connection and schema options                                |
| `src/database/database.module.ts`                                   | Configures the NestJS database connection                                           |
| `src/database/data-source.ts`                                       | Exports the standalone migration data source                                        |
| `src/database/database-errors.ts`                                   | Classifies duplicate-key and transient database errors                              |
| `src/database/migrations/1794096000000-create-identity-mappings.ts` | Creates and removes the identity table                                              |
| `src/identity/identity.entity.ts`                                   | Maps identity columns and the composite unique index                                |
| `src/identity/identity.controller.ts`                               | Exposes `POST /users/resolve`                                                       |
| `src/identity/identity.service.ts`                                  | Resolves pairs through cache/MySQL, generates UUIDs, and recovers duplicate inserts |
| `src/identity/dto/`                                                 | Defines request validation and code-point length checking                           |
| `src/identity/identity.repository.ts`                               | Looks up pairs and inserts mappings                                                 |
| `src/common/pipes/request-validation.pipe.ts`                       | Configures strict global request validation                                         |
| `src/common/filters/api-exception.filter.ts`                        | Returns consistent API errors and generic server logs                               |

## Development checks

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
```

There is no `npm test` command or automated test suite at this stage.

## Revert a local migration

```bash
npm run migration:revert
```

This reverts the most recent migration. Reverting the initial migration drops `identity_mappings` and permanently deletes its rows. Use this only for disposable local data. MySQL DDL implicitly commits, so migration failures cannot be assumed to roll back atomically.
