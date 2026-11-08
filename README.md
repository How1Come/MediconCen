# MediconCen

NestJS and TypeScript project for resolving an ordered pair of identifiers to a persistent user ID in MySQL.

The current stage provides a validated POST endpoint, UUID v4 generation, MySQL persistence, and duplicate-request handling. Redis integration, a reusable automated test suite, Docker packaging, and OpenAPI documentation are scheduled for later stages.

## Prerequisites

- Node.js 22.13 or later within 22.x, or Node.js 24.11 or later, with npm.
- MySQL 8.0.18 or later within 8.x, with access to create a local database and account.

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

## Install and configure

```bash
npm ci
cp .env.example .env
```

Edit `.env` and set `MYSQL_PASSWORD` to the generated password. Quote the value so characters such as `#` are preserved. The example deliberately has a blank password, which fails configuration validation until supplied. Keep `.env` and real credentials out of Git.

| Variable         | Required | Default       | Purpose                                       |
| ---------------- | -------- | ------------- | --------------------------------------------- |
| `NODE_ENV`       | No       | `development` | `development`, `test`, or `production`        |
| `PORT`           | No       | `3000`        | HTTP listening port                           |
| `MYSQL_HOST`     | Yes      | None          | Database host; local example uses `127.0.0.1` |
| `MYSQL_PORT`     | No       | `3306`        | Database TCP port                             |
| `MYSQL_DATABASE` | Yes      | None          | Database name                                 |
| `MYSQL_USER`     | Yes      | None          | Database account                              |
| `MYSQL_PASSWORD` | Yes      | None          | Nonempty database password                    |

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
- MySQL remains the permanent source of truth. Redis behavior will be added in a later stage.

## Project structure

| File                                                                | Responsibility                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `src/main.ts`                                                       | Bootstraps NestJS and enables shutdown hooks                    |
| `src/app.module.ts`                                                 | Wires modules and global `APP_PIPE`/`APP_FILTER` providers      |
| `src/config/environment.ts`                                         | Validates and types environment configuration                   |
| `src/database/database.options.ts`                                  | Defines shared TypeORM connection and schema options            |
| `src/database/database.module.ts`                                   | Configures the NestJS database connection                       |
| `src/database/data-source.ts`                                       | Exports the standalone migration data source                    |
| `src/database/database-errors.ts`                                   | Classifies duplicate-key and transient database errors          |
| `src/database/migrations/1794096000000-create-identity-mappings.ts` | Creates and removes the identity table                          |
| `src/identity/identity.entity.ts`                                   | Maps identity columns and the composite unique index            |
| `src/identity/identity.controller.ts`                               | Exposes `POST /users/resolve`                                   |
| `src/identity/identity.service.ts`                                  | Resolves pairs, generates UUIDs, and recovers duplicate inserts |
| `src/identity/dto/`                                                 | Defines request validation and code-point length checking       |
| `src/identity/identity.repository.ts`                               | Looks up pairs and inserts mappings                             |
| `src/common/pipes/request-validation.pipe.ts`                       | Configures strict global request validation                     |
| `src/common/filters/api-exception.filter.ts`                        | Returns consistent API errors and generic server logs           |

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
