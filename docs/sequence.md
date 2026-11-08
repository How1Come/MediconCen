# Processing sequences

These diagrams describe `POST /users/resolve`. `IdentityCache` wraps the optional Redis connection. The first diagram shows sequential resolution; the second expands the insert race when two requests miss the same new pair. Return to the [README](../README.md) for setup, configuration and the API contract.

## Resolve a request

```mermaid
sequenceDiagram
    participant Client
    participant API as NestJS API
    participant Cache as IdentityCache
    participant DB as MySQL

    Client->>API: POST id1 and id2
    API->>API: Validate strings and Unicode length
    alt Invalid request
        API-->>Client: 400 validation messages
    else Valid request
        API->>Cache: Resolve pair cache key
        alt Valid cached UUID
            Cache-->>API: Cached userID
            API-->>Client: 200 userID
        else Miss, invalid value, disabled or unavailable
            Cache-->>API: Cache miss
            API->>DB: SELECT by exact ordered pair
            alt Pair exists
                DB-->>API: Stored userID
            else Pair does not exist
                DB-->>API: No row
                API->>API: Generate UUID v4
                API->>DB: INSERT pair and UUID
                DB-->>API: Insert confirmed
            end
            API->>Cache: Try SET confirmed userID with TTL
            Cache-->>API: Stored, skipped or failed safely
            API-->>Client: 200 confirmed userID
        end
    end
```

`IdentityCache` skips network I/O when disabled, unready or closing. A GET failure or local deadline is a miss; a SET failure is ignored after database success. A cache hit returns immediately without querying MySQL or extending the TTL.

An unrecovered database error ends resolution without a cache write. The exception filter returns `503` for recognized transient database failures and `500` for other unexpected failures, with no driver details in the response. The insert-conflict recovery path is shown below.

## Resolve concurrent first requests

```mermaid
sequenceDiagram
    participant A as Request A
    participant B as Request B
    participant DB as MySQL
    participant Cache as IdentityCache

    Note over A,B: Same new pair<br/>Validation passed<br/>Both cache misses
    A->>DB: SELECT pair
    DB-->>A: No row
    B->>DB: SELECT pair
    DB-->>B: No row
    A->>A: Generate UUID A
    B->>B: Generate UUID B
    A->>DB: INSERT pair and UUID A
    DB-->>A: Insert committed
    A->>Cache: Try SET pair to confirmed UUID A with TTL
    Cache-->>A: Stored, skipped or failed safely
    B->>DB: INSERT same pair and UUID B
    DB-->>B: ER_DUP_ENTRY
    B->>DB: SELECT pair again
    DB-->>B: Persisted UUID A
    B->>Cache: Try SET pair to confirmed UUID A with TTL
    Cache-->>B: Stored, skipped or failed safely
    Note over A,B: Both return HTTP 200<br/>with UUID A
```

The composite unique index on `(id1, id2)` selects one persistent mapping across application instances. Each request uses MySQL autocommit; no Redis lock or explicit transaction coordinates them. UUID B is never returned or cached.

Only a TypeORM-wrapped `ER_DUP_ENTRY` triggers the extra lookup. If that lookup finds no matching pair, the original duplicate error is rethrown; if the lookup fails, its error propagates. Neither case writes a tentative UUID to the cache.
