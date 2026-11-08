# MediconCen

NestJS and TypeScript project for resolving an ordered pair of identifiers to a persistent user ID in MySQL.

The current stage provides application configuration, database migrations, and the identity repository. The POST endpoint, UUID v4 generation service, Redis integration, and automated test suite are scheduled for later stages.

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

Run from the repository root:

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

The default port is `3000`. No HTTP routes are registered at this stage, so requests return `404`. A running application requires an available MySQL server and valid credentials. Apply migrations before using the repository; startup does not check or create its table.

## Data model and decisions

| Column   | Definition                        | Purpose                                        |
| -------- | --------------------------------- | ---------------------------------------------- |
| `userID` | `CHAR(36)`, ASCII, primary key    | Stores a canonical UUID supplied by the caller |
| `id1`    | `VARCHAR(255)`, utf8mb4, not null | Stores the first identifier                    |
| `id2`    | `VARCHAR(255)`, utf8mb4, not null | Stores the second identifier                   |

- Pair identity is ordered: `(A, B)` and `(B, A)` are different pairs.
- Both identifiers support up to 255 Unicode characters. Their `utf8mb4_0900_bin` collation preserves distinctions in case, leading/trailing whitespace, and Unicode normalization forms; no identifier normalization is performed.
- A composite unique index on `(id1, id2)` prevents duplicate pairs and supports pair lookup. Each pair maps to one `userID`.
- The repository exposes `findByPair` and `insert`. Inserts use TypeORM `insert`, preventing an existing primary key from being silently updated through `save`.
- The service stage will generate UUID v4 values with `crypto.randomUUID()`. The current schema enforces the primary key and column shape without checking UUID version.
- The application and CLI share database options. Automatic schema synchronization and migration execution on startup are disabled; schema changes use versioned migrations.
- MySQL remains the permanent source of truth. Redis behavior and recovery from simultaneous duplicate inserts will be implemented in later stages.

## Project structure

| File                                                                | Responsibility                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| `src/main.ts`                                                       | Bootstraps NestJS and enables shutdown hooks         |
| `src/app.module.ts`                                                 | Wires configuration, database, and identity modules  |
| `src/config/environment.ts`                                         | Validates and types environment configuration        |
| `src/database/database.options.ts`                                  | Defines shared TypeORM connection and schema options |
| `src/database/database.module.ts`                                   | Configures the NestJS database connection            |
| `src/database/data-source.ts`                                       | Exports the standalone migration data source         |
| `src/database/migrations/1794096000000-create-identity-mappings.ts` | Creates and removes the identity table               |
| `src/identity/identity.entity.ts`                                   | Maps identity columns and the composite unique index |
| `src/identity/identity.repository.ts`                               | Looks up pairs and inserts mappings                  |
| `src/identity/identity.module.ts`                                   | Registers and exports the repository                 |

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
