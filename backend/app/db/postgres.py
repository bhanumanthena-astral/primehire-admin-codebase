"""PostgreSQL-backed V2 document repositories, with SQL-side queries and indexes.

One JSONB table per existing domain preserves IDs and encrypted payloads during
cutover. There is no MongoDB process or in-memory persistence in this backend.
Short, collection-scoped transaction locks preserve conditional writes/upserts.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import threading
import time
import uuid
from datetime import datetime, timezone

from bson import ObjectId
from psycopg import errors
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from pymongo.errors import ConnectionFailure, DuplicateKeyError, OperationFailure
from pymongo.results import DeleteResult, InsertManyResult, InsertOneResult, UpdateResult

from .postgres_query import Query, decode, encode, identifier, literal


def get_path(document, path, default=None):
    current = document
    for key in path.split("."):
        if isinstance(current, list) and key.isdigit():
            current = current[int(key)] if int(key) < len(current) else default
        elif isinstance(current, dict):
            current = current.get(key, default)
        else:
            return default
    return current


def set_path(document, path, value, *, unset=False):
    parts = path.split(".")
    current = document
    for key in parts[:-1]:
        child = current.get(key)
        if not isinstance(child, dict):
            child = current[key] = {}
        current = child
    if unset:
        current.pop(parts[-1], None)
    else:
        current[parts[-1]] = copy.deepcopy(value)


def evaluate(value, document):
    """Evaluate the bounded LLM token-bucket update pipeline under a SQL lock."""
    if isinstance(value, str) and value.startswith("$"):
        return get_path(document, value[1:])
    if isinstance(value, list):
        return [evaluate(v, document) for v in value]
    if not isinstance(value, dict):
        return value
    if not any(k.startswith("$") for k in value):
        return {k: evaluate(v, document) for k, v in value.items()}
    op, args = next(iter(value.items()))
    if op == "$literal":
        return args
    if op == "$ifNull":
        values = [evaluate(v, document) for v in args]
        return next((v for v in values if v is not None), None)
    if op == "$cond":
        condition, yes, no = args
        return evaluate(yes if evaluate(condition, document) else no, document)
    values = [evaluate(v, document) for v in args]
    if op == "$min": return min(values)
    if op == "$max": return max(values)
    if op == "$add": return sum(values)
    if op == "$multiply":
        result = 1
        for v in values: result *= v
        return result
    if op == "$divide": return values[0] / values[1]
    if op == "$subtract":
        if all(isinstance(v, datetime) for v in values):
            stamps = [v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v.astimezone(timezone.utc) for v in values]
            return (stamps[0] - stamps[1]).total_seconds() * 1000
        return values[0] - values[1]
    if op == "$gte": return values[0] >= values[1]
    if op == "$gt": return values[0] > values[1]
    if op == "$eq": return values[0] == values[1]
    raise NotImplementedError("Unsupported PostgreSQL update expression " + op)


def apply_update(document, update, *, inserted=False):
    result = copy.deepcopy(document)
    if isinstance(update, list):
        for stage in update:
            if set(stage) != {"$set"}:
                raise NotImplementedError("Unsupported PostgreSQL update pipeline")
            snapshot = copy.deepcopy(result)
            for key, value in stage["$set"].items():
                set_path(result, key, evaluate(value, snapshot))
        return result
    for operator, changes in update.items():
        if operator == "$setOnInsert" and not inserted:
            continue
        if operator not in {"$set", "$setOnInsert", "$inc", "$unset"}:
            raise NotImplementedError("Unsupported PostgreSQL update " + operator)
        for key, value in changes.items():
            if operator == "$inc":
                value = get_path(result, key, 0) + value
            set_path(result, key, value, unset=operator == "$unset")
    if result.get("_id") != document.get("_id"):
        raise ValueError("Document identity cannot change")
    return result


class Cursor:
    def __init__(self, collection, filters=None, projection=None, pipeline=None):
        self.collection, self.filters, self.projection = collection, filters, projection
        self.pipeline, self.ordering, self.offset, self.maximum = pipeline, [], 0, 0

    def sort(self, key, direction=1):
        self.ordering = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    def skip(self, count):
        if count < 0: raise ValueError("Negative offset")
        self.offset = count
        return self

    def limit(self, count):
        if count < 0: raise ValueError("Negative limit")
        self.maximum = count
        return self

    async def to_list(self, length=None):
        maximum = min(self.maximum, length) if self.maximum and length is not None else self.maximum or length
        return await self.collection._read(self, maximum)

    def __aiter__(self):
        return self.collection._iterate(self)


class PostgresDatabase:
    backend = "postgresql"

    def __init__(self, dsn, name="primehire_admin_v2", schema="elitehr", *, pool_size=8):
        self.name, self.schema = name, schema
        self.quoted_schema = identifier(schema)
        self.pool = ConnectionPool(dsn, min_size=0, max_size=pool_size, timeout=10, open=True,
            kwargs={"connect_timeout": 5, "options": "-c statement_timeout=30000 -c lock_timeout=10000", "application_name": "elitehr-v2"})
        self._initialized, self._tables = False, set()
        self._initialization = threading.RLock()
        self._last_cleanup = {}

    def __getitem__(self, name):
        return Collection(self, name)

    def __getattr__(self, name):
        if name.startswith("_"): raise AttributeError(name)
        return self[name]

    def _initialize(self):
        with self._initialization:
            if self._initialized: return
            schema = self.quoted_schema
            with self.pool.connection() as connection:
                connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", (self.schema + ":schema",))
                connection.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
                connection.execute(f"""CREATE TABLE IF NOT EXISTS {schema}._store_indexes (
                    collection text NOT NULL, name text NOT NULL, specification jsonb NOT NULL,
                    PRIMARY KEY(collection,name))""")
                connection.execute(f"""CREATE OR REPLACE FUNCTION {schema}.field(value jsonb,path text[])
                    RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
                    DECLARE child jsonb; item jsonb; result jsonb := '[]'::jsonb;
                    BEGIN
                        IF array_length(path,1) IS NULL THEN RETURN value; END IF;
                        IF jsonb_typeof(value)='array' AND path[1] !~ '^[0-9]+$' THEN
                            FOR child IN SELECT jsonb_array_elements(value) LOOP
                                item := {schema}.field(child,path);
                                IF item IS NOT NULL THEN result := result || jsonb_build_array(item); END IF;
                            END LOOP;
                            RETURN result;
                        END IF;
                        IF jsonb_typeof(value)='array' THEN child := value -> (path[1]::int);
                        ELSE child := value -> path[1]; END IF;
                        IF array_length(path,1)=1 THEN RETURN child; END IF;
                        RETURN {schema}.field(child,path[2:]);
                    END $$""")
                connection.execute(f"""CREATE OR REPLACE FUNCTION {schema}.set_field(value jsonb,path text[],item jsonb)
                    RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
                    DECLARE child jsonb;
                    BEGIN
                        IF item IS NULL THEN RETURN value; END IF;
                        IF array_length(path,1)=1 THEN RETURN jsonb_set(value,path,item,true); END IF;
                        child := value -> path[1];
                        IF child IS NULL OR jsonb_typeof(child)<>'object' THEN child := '{{}}'::jsonb; END IF;
                        RETURN jsonb_set(value,ARRAY[path[1]],{schema}.set_field(child,path[2:],item),true);
                    END $$""")
            self._initialized = True

    def _ensure(self, names):
        self._initialize()
        with self._initialization:
            for name in sorted(set(names) - self._tables):
                table = self.quoted_schema + "." + identifier(name)
                with self.pool.connection() as connection:
                    connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", (self.schema + ":" + name,))
                    connection.execute(f"CREATE TABLE IF NOT EXISTS {table} (id jsonb PRIMARY KEY, doc jsonb NOT NULL, _ord bigserial UNIQUE, CHECK(doc->'_id'=id))")
                self._tables.add(name)

    async def _run(self, operation):
        def invoke():
            try:
                return operation()
            except errors.UniqueViolation:
                raise DuplicateKeyError("A database uniqueness constraint was violated") from None
            except (errors.OperationalError, errors.InterfaceError,
                    errors.QueryCanceled, errors.LockNotAvailable, errors.DeadlockDetected):
                raise ConnectionFailure("PostgreSQL is temporarily unavailable") from None
        return await asyncio.to_thread(invoke)

    async def command(self, command, *args, **kwargs):
        if command != "ping": raise NotImplementedError("Unsupported database command")
        def probe():
            with self.pool.connection() as connection:
                connection.execute("SELECT 1").fetchone()
            return {"ok": 1}
        return await self._run(probe)

    async def list_collection_names(self):
        def names():
            self._initialize()
            with self.pool.connection() as connection:
                rows = connection.execute("SELECT tablename FROM pg_tables WHERE schemaname=%s AND tablename <> '_store_indexes' ORDER BY tablename", (self.schema,)).fetchall()
                return [row[0] for row in rows]
        return await self._run(names)

    def close(self):
        self.pool.close()


class Collection:
    def __init__(self, database, name):
        self.database, self.name = database, name
        self.full_name = database.name + "." + name
        self.table = database.quoted_schema + "." + identifier(name)

    def find(self, filter=None, projection=None, **kwargs):
        cursor = Cursor(self, filter, projection)
        if kwargs.get("sort"): cursor.sort(kwargs["sort"])
        if kwargs.get("skip"): cursor.skip(kwargs["skip"])
        if kwargs.get("limit"): cursor.limit(kwargs["limit"])
        return cursor

    def aggregate(self, pipeline, **kwargs):
        return Cursor(self, pipeline=pipeline)

    async def find_one(self, filter=None, projection=None, *, sort=None, **kwargs):
        if filter is not None and not isinstance(filter, dict): filter = {"_id": filter}
        cursor = self.find(filter, projection)
        if sort: cursor.sort(sort)
        rows = await cursor.to_list(1)
        return rows[0] if rows else None

    def _lock(self, connection):
        connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", (self.database.schema + ":" + self.name,))

    def _cleanup(self, connection):
        stamp = time.monotonic()
        if stamp - self.database._last_cleanup.get(self.name, -60) < 60: return
        self.database._last_cleanup[self.name] = stamp
        rows = connection.execute(f"SELECT specification FROM {self.database.quoted_schema}._store_indexes WHERE collection=%s", (self.name,)).fetchall()
        for (spec,) in rows:
            if "expireAfterSeconds" not in spec: continue
            from datetime import timedelta
            query = Query(self.database.schema)
            condition = query.match({spec["keys"][0][0]: {"$lte": datetime.now(timezone.utc) - timedelta(seconds=spec["expireAfterSeconds"])}})
            connection.execute(f"DELETE FROM {self.table} WHERE {condition}", query.params)

    def _statement(self, cursor, maximum):
        names = [self.name]
        for stage in cursor.pipeline or []:
            if "$lookup" in stage: names.append(stage["$lookup"]["from"])
        self.database._ensure(names)
        query = Query(self.database.schema)
        source = f"SELECT doc,_ord FROM {self.table}"
        if cursor.pipeline is not None:
            statement = query.pipeline(source, cursor.pipeline)
        else:
            statement = source + " WHERE " + query.match(cursor.filters)
            if cursor.ordering:
                statement = f"SELECT doc,row_number() OVER (ORDER BY {query.sort(cursor.ordering)},_ord) _ord FROM ({statement}) ordered"
        projection = query.project(cursor.projection) if cursor.projection else "doc"
        statement = f"SELECT {projection} FROM ({statement}) page ORDER BY _ord"
        if maximum is not None:
            statement += " LIMIT " + str(int(maximum))
        return query.statement(statement + " OFFSET " + str(cursor.offset)), query.params

    async def _read(self, cursor, maximum):
        def execute():
            statement, params = self._statement(cursor, maximum)
            with self.database.pool.connection() as connection:
                self._cleanup(connection)
                return [decode(row[0]) for row in connection.execute(statement, params).fetchall()]
        return await self.database._run(execute)

    async def _iterate(self, specification):
        # A server cursor retains its result snapshot while callers update or
        # delete matching rows. OFFSET pagination would skip those records.
        connection = cursor = None
        def start():
            nonlocal connection, cursor
            statement, params = self._statement(specification, specification.maximum or None)
            # Commit expiry cleanup before opening a streaming read. Otherwise
            # an awaited upsert inside the iteration could wait on a deleted
            # expired row still locked by this iterator's own transaction.
            with self.database.pool.connection() as maintenance:
                self._cleanup(maintenance)
            connection = self.database.pool.getconn()
            try:
                cursor = connection.cursor(name="elitehr_" + uuid.uuid4().hex)
                cursor.execute(statement, params)
            except BaseException:
                connection.rollback()
                self.database.pool.putconn(connection)
                connection = None
                raise
        try:
            await self.database._run(start)
            while True:
                page = await self.database._run(lambda: cursor.fetchmany(250))
                if not page: break
                for row in page: yield decode(row[0])
        finally:
            if connection is not None:
                def finish():
                    try:
                        if cursor is not None: cursor.close()
                        connection.commit()
                    except BaseException:
                        connection.rollback()
                        raise
                    finally:
                        self.database.pool.putconn(connection)
                await asyncio.to_thread(finish)

    async def count_documents(self, filter, **kwargs):
        rows = await self.aggregate([{"$match": filter}, {"$count": "n"}]).to_list(1)
        return rows[0]["n"] if rows else 0

    async def distinct(self, key, filter=None):
        def execute():
            self.database._ensure([self.name])
            query = Query(self.database.schema)
            field = query.field(key)
            source = f"CASE WHEN jsonb_typeof({field})='array' THEN {field} ELSE jsonb_build_array({field}) END"
            statement = f"SELECT DISTINCT e.value FROM {self.table} CROSS JOIN LATERAL jsonb_array_elements({source}) e WHERE {query.match(filter)} AND e.value IS NOT NULL"
            with self.database.pool.connection() as connection:
                self._cleanup(connection)
                return [decode(row[0]) for row in connection.execute(statement, query.params)]
        return await self.database._run(execute)

    async def insert_one(self, document):
        document.setdefault("_id", ObjectId())
        def execute():
            self.database._ensure([self.name])
            with self.database.pool.connection() as connection:
                self._lock(connection)
                connection.execute(f"INSERT INTO {self.table}(id,doc) VALUES(%s,%s)", (Jsonb(encode(document["_id"])), Jsonb(encode(document))))
            return InsertOneResult(document["_id"], True)
        return await self.database._run(execute)

    async def insert_many(self, documents, ordered=True):
        identities = []
        for document in documents:
            result = await self.insert_one(document)
            identities.append(result.inserted_id)
        return InsertManyResult(identities, True)

    async def _update(self, filter, update, *, upsert=False, many=False, returning=None, sort=None, replacement=False, projection=None):
        def execute():
            self.database._ensure([self.name])
            query = Query(self.database.schema)
            condition = query.match(filter)
            ordering = query.sort(sort) if sort else "_ord"
            with self.database.pool.connection() as connection:
                self._lock(connection)
                self._cleanup(connection)
                statement = f"SELECT doc FROM {self.table} WHERE {condition} ORDER BY {ordering}" + ("" if many else " LIMIT 1") + " FOR UPDATE"
                rows = [decode(row[0]) for row in connection.execute(statement, query.params)]
                matched, changed, identity, old, new = len(rows), 0, None, None, None
                if not rows and upsert:
                    seed = {}
                    for key, value in filter.items():
                        if not key.startswith("$") and (not isinstance(value, dict) or not any(k.startswith("$") for k in value)):
                            set_path(seed, key, value)
                    # $setOnInsert may supply a stable candidate/application ID.
                    # Respect it when the equality filter has no explicit _id.
                    proposed = update.get('$setOnInsert', {}).get('_id') if isinstance(update,dict) else None
                    if '_id' not in seed:
                        seed['_id'] = proposed if proposed is not None else ObjectId()
                    rows = [seed]
                    identity = seed["_id"]
                for old in rows:
                    if replacement:
                        new = {**copy.deepcopy(update), "_id": old["_id"]}
                    else:
                        new = apply_update(old, update, inserted=identity is not None)
                    if identity is not None:
                        connection.execute(f"INSERT INTO {self.table}(id,doc) VALUES(%s,%s)", (Jsonb(encode(identity)), Jsonb(encode(new))))
                    elif encode(old) != encode(new):
                        connection.execute(f"UPDATE {self.table} SET doc=%s WHERE id=%s", (Jsonb(encode(new)), Jsonb(encode(old["_id"]))))
                        changed += 1
                if returning is not None:
                    result = new if returning else (None if identity is not None else old)
                    if result is not None and projection:
                        # Reuse SQL projection, including nested fields and missing/null semantics.
                        projector = Query(self.database.schema)
                        source = projector.param(result)
                        projected = projector.project(projection, source)
                        result = decode(connection.execute("SELECT " + projected, projector.params).fetchone()[0])
                    return result
                return UpdateResult({"n": matched or (1 if identity is not None else 0), "nModified": changed, "upserted": identity}, True)
        return await self.database._run(execute)

    async def update_one(self, filter, update, upsert=False, **kwargs):
        return await self._update(filter, update, upsert=upsert)

    async def update_many(self, filter, update, upsert=False, **kwargs):
        return await self._update(filter, update, upsert=upsert, many=True)

    async def replace_one(self, filter, replacement, upsert=False, **kwargs):
        return await self._update(filter, replacement, upsert=upsert, replacement=True)

    async def find_one_and_update(self, filter, update, *, upsert=False, return_document=False, sort=None, projection=None, **kwargs):
        return await self._update(filter, update, upsert=upsert, returning=bool(return_document), sort=sort, projection=projection)

    async def _delete(self, filter, *, many=False, returning=False):
        def execute():
            self.database._ensure([self.name])
            query = Query(self.database.schema)
            condition = query.match(filter)
            with self.database.pool.connection() as connection:
                self._lock(connection)
                target = f"SELECT id FROM {self.table} WHERE {condition} ORDER BY _ord" + ("" if many else " LIMIT 1")
                rows = connection.execute(f"DELETE FROM {self.table} WHERE id IN ({target}) RETURNING doc", query.params).fetchall()
                return (decode(rows[0][0]) if rows else None) if returning else DeleteResult({"n": len(rows)}, True)
        return await self.database._run(execute)

    async def delete_one(self, filter, **kwargs): return await self._delete(filter)
    async def delete_many(self, filter, **kwargs): return await self._delete(filter, many=True)
    async def find_one_and_delete(self, filter, **kwargs): return await self._delete(filter, returning=True)

    def _index_name(self, name):
        digest = hashlib.sha256((self.database.schema + ":" + self.name + ":" + name).encode()).hexdigest()[:24]
        return '"ix_' + digest + '"'

    async def create_index(self, keys, **kwargs):
        if isinstance(keys, str): keys = [(keys, 1)]
        name = kwargs.get("name") or "_".join(f"{key}_{direction}" for key, direction in keys)
        def execute():
            self.database._ensure([self.name])
            query = Query(self.database.schema)
            expressions = []
            for key, direction in keys:
                expression = query.field(key)
                # Missing and explicit null share Mongo's uniqueness semantics.
                if kwargs.get("unique"): expression = f"COALESCE({expression},'null'::jsonb)"
                expressions.append("(" + expression + ")" + (" DESC" if direction == -1 else ""))
            predicate = kwargs.get("partialFilterExpression", {})
            if kwargs.get("sparse"):
                predicate = {"$and": [predicate, {"$or": [{k: {"$exists": True}} for k, _ in keys]}]}
            condition = query.match(predicate)
            # CREATE INDEX does not accept bind parameters in stored predicates.
            for key, value in sorted(query.params.items(), key=lambda pair: len(pair[0]), reverse=True):
                raw = value.obj if isinstance(value, Jsonb) else value
                condition = condition.replace("%(" + key + ")s::jsonb", literal(json.dumps(raw)) + "::jsonb")
                condition = condition.replace("%(" + key + ")s", literal(raw))
            with self.database.pool.connection() as connection:
                self._lock(connection)
                unique = "UNIQUE " if kwargs.get("unique") else ""
                connection.execute(f"CREATE {unique}INDEX IF NOT EXISTS {self._index_name(name)} ON {self.table} ({','.join(expressions)}) WHERE {condition}")
                spec = {"keys": list(keys), **kwargs}
                connection.execute(f"INSERT INTO {self.database.quoted_schema}._store_indexes(collection,name,specification) VALUES(%s,%s,%s) ON CONFLICT(collection,name) DO UPDATE SET specification=EXCLUDED.specification", (self.name, name, Jsonb(spec)))
            return name
        return await self.database._run(execute)

    async def index_information(self):
        def execute():
            self.database._initialize()
            with self.database.pool.connection() as connection:
                rows = connection.execute(f"SELECT name,specification FROM {self.database.quoted_schema}._store_indexes WHERE collection=%s", (self.name,)).fetchall()
                return {"_id_": {"key": [("_id", 1)], "unique": True}, **{name: {**spec, "key": [tuple(pair) for pair in spec["keys"]]} for name, spec in rows}}
        return await self.database._run(execute)

    async def drop_index(self, name):
        def execute():
            self.database._initialize()
            with self.database.pool.connection() as connection:
                self._lock(connection)
                connection.execute(f"DROP INDEX IF EXISTS {self.database.quoted_schema}.{self._index_name(name)}")
                connection.execute(f"DELETE FROM {self.database.quoted_schema}._store_indexes WHERE collection=%s AND name=%s", (self.name, name))
        return await self.database._run(execute)
