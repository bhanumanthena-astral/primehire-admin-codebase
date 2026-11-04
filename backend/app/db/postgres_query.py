"""Compile the application's document queries to parameterized PostgreSQL JSONB SQL.

This is deliberately a bounded application dialect, not a MongoDB server. Unknown
operators fail closed. Filtering, joins, grouping and pagination execute in SQL.
"""
from __future__ import annotations

import base64
import re
from datetime import datetime, timezone
from decimal import Decimal

from bson import ObjectId
from psycopg import sql
from psycopg.types.json import Jsonb


def encode(value):
    if isinstance(value, datetime):
        stamp = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        return {"$date": stamp.isoformat(timespec="milliseconds")}
    if isinstance(value, ObjectId):
        return {"$oid": str(value)}
    if isinstance(value, bytes):
        return {"$binary": base64.b64encode(value).decode()}
    if isinstance(value, dict):
        return {str(k): encode(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [encode(v) for v in value]
    if isinstance(value, Decimal):
        return float(value)
    return value


def decode(value):
    if isinstance(value, dict):
        if set(value) == {"$date"}:
            return datetime.fromisoformat(value["$date"]).astimezone(timezone.utc).replace(tzinfo=None)
        if set(value) == {"$oid"}:
            return ObjectId(value["$oid"])
        if set(value) == {"$binary"}:
            return base64.b64decode(value["$binary"])
        return {k: decode(v) for k, v in value.items()}
    return [decode(v) for v in value] if isinstance(value, list) else value


def identifier(name):
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", name):
        raise ValueError("Invalid database identifier")
    return '"' + name + '"'


def literal(value):
    return sql.Literal(value).as_string()


class Query:
    def __init__(self, schema):
        self.schema = identifier(schema)
        self.params = {}
        self.serial = 0
        self.ctes = []

    def param(self, value, *, json=True):
        key = "v" + str(len(self.params))
        self.params[key] = Jsonb(encode(value)) if json else value
        return "%(" + key + ")s" + ("::jsonb" if json else "")

    def alias(self):
        self.serial += 1
        return "e" + str(self.serial)

    def field(self, path, document="doc"):
        if not isinstance(path, str) or not path or "\x00" in path:
            raise ValueError("Invalid field path")
        parts = path.split(".")
        arg = "ARRAY[" + ",".join(literal(p) for p in parts) + "]::text[]"
        return f"{self.schema}.field({document}, {arg})"

    @staticmethod
    def truth(expression):
        return f"COALESCE(({expression}) NOT IN ('null'::jsonb, 'false'::jsonb, '0'::jsonb), false)"

    @staticmethod
    def number(expression):
        return f"CASE WHEN jsonb_typeof({expression}) = 'number' THEN ({expression})::numeric ELSE 0 END"

    def expr(self, value, document="doc", variables=None):
        variables = variables or {}
        if isinstance(value, str) and value.startswith("$$"):
            name, _, rest = value[2:].partition(".")
            source = document if name == "ROOT" else variables[name]
            return self.field(rest, source) if rest else source
        if isinstance(value, str) and value.startswith("$"):
            return self.field(value[1:], document)
        if isinstance(value, list):
            return "jsonb_build_array(" + ",".join(self.expr(v, document, variables) for v in value) + ")"
        if not isinstance(value, dict):
            return self.param(value)
        if not any(k.startswith("$") for k in value):
            pairs = [literal(k) + "," + self.expr(v, document, variables) for k, v in value.items()]
            return "jsonb_build_object(" + ",".join(pairs) + ")"
        if len(value) != 1:
            raise ValueError("Invalid expression")
        operator, args = next(iter(value.items()))
        ex = lambda v: self.expr(v, document, variables)
        if operator == "$literal":
            return self.param(args)
        if operator == "$ifNull":
            return "COALESCE(" + ",".join(f"NULLIF({ex(v)},'null'::jsonb)" for v in args) + ")"
        if operator in {"$eq", "$ne", "$gt", "$gte", "$lt", "$lte"}:
            left, right = (ex(v) for v in args)
            sign = {"$eq": "=", "$ne": "<>", "$gt": ">", "$gte": ">=", "$lt": "<", "$lte": "<="}[operator]
            return f"to_jsonb(COALESCE({left},'null'::jsonb) {sign} COALESCE({right},'null'::jsonb))"
        if operator in {"$and", "$or"}:
            join = " AND " if operator == "$and" else " OR "
            return "to_jsonb(" + join.join(self.truth(ex(v)) for v in args) + ")"
        if operator == "$not":
            return f"to_jsonb(NOT {self.truth(ex(args[0]))})"
        if operator == "$in":
            return f"to_jsonb(COALESCE(({ex(args[1])}) @> jsonb_build_array({ex(args[0])}), false))"
        if operator == "$cond":
            condition, yes, no = (args["if"], args["then"], args["else"]) if isinstance(args, dict) else args
            return f"CASE WHEN {self.truth(ex(condition))} THEN {ex(yes)} ELSE {ex(no)} END"
        if operator == "$size":
            source = ex(args)
            return f"to_jsonb(COALESCE(jsonb_array_length({source}),0))"
        if operator == "$filter":
            alias = self.alias()
            source = ex(args["input"])
            nested = {**variables, args.get("as", "this"): alias + ".value"}
            condition = self.truth(self.expr(args["cond"], document, nested))
            return f"(SELECT COALESCE(jsonb_agg({alias}.value ORDER BY {alias}.ordinality),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(NULLIF({source},'null'::jsonb),'[]'::jsonb)) WITH ORDINALITY {alias} WHERE {condition})"
        if operator == "$setUnion":
            source = " || ".join(f"COALESCE(NULLIF({ex(v)},'null'::jsonb),'[]'::jsonb)" for v in args)
            return f"(SELECT COALESCE(jsonb_agg(DISTINCT value),'[]'::jsonb) FROM jsonb_array_elements({source}))"
        raise NotImplementedError("Unsupported PostgreSQL expression " + operator)

    def equal(self, expression, value):
        target = self.param(value)
        if value is None:
            return f"({expression} IS NULL OR {expression} = 'null'::jsonb OR {expression} @> '[null]'::jsonb)"
        if isinstance(value, (dict, list)):
            return f"COALESCE({expression} = {target},false)"
        array = self.param([value])
        return f"COALESCE(({expression} = {target} OR (jsonb_typeof({expression})='array' AND {expression} @> {array})),false)"

    def condition(self, expression, value):
        if not isinstance(value, dict) or not any(k.startswith("$") for k in value):
            return self.equal(expression, value)
        clauses = []
        for op, operand in value.items():
            if op == "$options":
                continue
            if op == "$eq":
                clauses.append(self.equal(expression, operand))
            elif op == "$ne":
                clauses.append("NOT " + self.equal(expression, operand))
            elif op in {"$in", "$nin"}:
                match = "(" + " OR ".join(self.equal(expression, v) for v in operand) + ")" if operand else "false"
                clauses.append(("NOT " if op == "$nin" else "") + match)
            elif op in {"$gt", "$gte", "$lt", "$lte"}:
                sign = {"$gt": ">", "$gte": ">=", "$lt": "<", "$lte": "<="}[op]
                target = self.param(operand)
                clauses.append(f"COALESCE(jsonb_typeof({expression})=jsonb_typeof({target}) AND {expression} {sign} {target}, false)")
            elif op == "$exists":
                clauses.append(f"{expression} IS " + ("NOT NULL" if operand else "NULL"))
            elif op == "$type":
                if operand == 'date':
                    clauses.append(f"COALESCE(jsonb_typeof({expression})='object' AND jsonb_typeof(({expression})->'$date')='string',false)")
                    continue
                kind = {"string": "string", "object": "object", "array": "array", "number": "number", "bool": "boolean"}.get(operand)
                if not kind:
                    raise NotImplementedError("Unsupported field type")
                clauses.append(f"COALESCE(jsonb_typeof({expression})={literal(kind)},false)")
            elif op == "$regex":
                pattern = self.param(operand.pattern if hasattr(operand, "pattern") else operand, json=False)
                sign = "~*" if "i" in value.get("$options", "") else "~"
                # The application's search patterns are escaped with re.escape.
                alias = self.alias()
                source = f"CASE WHEN jsonb_typeof({expression})='array' THEN {expression} ELSE jsonb_build_array({expression}) END"
                clauses.append(f"EXISTS(SELECT 1 FROM jsonb_array_elements({source}) {alias} WHERE jsonb_typeof({alias}.value)='string' AND ({alias}.value #>> '{{}}') {sign} {pattern})")
            elif op == "$size":
                clauses.append(f"CASE WHEN jsonb_typeof({expression})='array' THEN jsonb_array_length({expression}) = {self.param(operand,json=False)} ELSE false END")
            elif op == "$not":
                clauses.append("NOT (" + self.condition(expression, operand) + ")")
            elif op == "$elemMatch":
                alias = self.alias()
                source = f"CASE WHEN jsonb_typeof({expression})='array' THEN {expression} ELSE '[]'::jsonb END"
                clauses.append(f"EXISTS(SELECT 1 FROM jsonb_array_elements({source}) {alias} WHERE {self.match(operand,alias+'.value')})")
            else:
                raise NotImplementedError("Unsupported PostgreSQL predicate " + op)
        return "(" + " AND ".join(clauses) + ")"

    def match(self, filters=None, document="doc"):
        parts = []
        for key, value in (filters or {}).items():
            if key in {"$and", "$or", "$nor"}:
                join = " AND " if key == "$and" else " OR "
                condition = "(" + join.join(self.match(v, document) for v in value) + ")" if value else ("true" if key == "$and" else "false")
                parts.append(("NOT " if key == "$nor" else "") + condition)
            elif key == "$expr":
                parts.append(self.truth(self.expr(value, document)))
            elif key.startswith("$"):
                raise NotImplementedError("Unsupported PostgreSQL query " + key)
            else:
                parts.append(self.condition(self.field(key, document), value))
        return "(" + " AND ".join(parts) + ")" if parts else "true"

    def sort(self, spec, document="doc"):
        pairs = list(spec.items()) if isinstance(spec, dict) else spec
        return ",".join(self.field(key, document) + (" DESC NULLS LAST" if direction < 0 else " ASC NULLS FIRST") for key, direction in pairs)

    def set_path(self, document, path, value):
        return f"{self.schema}.set_field({document}, ARRAY[" + ",".join(literal(p) for p in path.split(".")) + f"]::text[], {value})"

    def project(self, spec, document="doc"):
        included = [k for k, v in spec.items() if k != "_id" and v != 0]
        if spec == {"_id": 1}:
            return "jsonb_build_object('_id'," + self.field('_id',document) + ")"
        if not included:
            result = document
            for key, value in spec.items():
                if value != 0:
                    raise NotImplementedError("Invalid projection")
                result = f"({result} #- ARRAY[" + ",".join(literal(p) for p in key.split(".")) + "]::text[])"
            return result
        result = "'{}'::jsonb"
        if spec.get("_id", 1):
            included.insert(0, "_id")
        for key in included:
            value = spec.get(key, 1)
            expression = self.field(key, document) if value == 1 else self.expr(value, document)
            result = self.set_path(result, key, expression)
        return result

    def pipeline(self, source, stages):
        current = source
        for stage in stages:
            if len(stage) != 1:
                raise ValueError("Invalid pipeline stage")
            op, spec = next(iter(stage.items()))
            base = f"({current}) q"
            if op == "$match":
                current = f"SELECT doc,_ord FROM {base} WHERE {self.match(spec)}"
            elif op == "$sort":
                ordering = self.sort(spec) + ",_ord"
                current = f"SELECT doc,row_number() OVER (ORDER BY {ordering}) AS _ord FROM {base}"
            elif op in {"$skip", "$limit"}:
                if not isinstance(spec, int) or spec < 0:
                    raise ValueError("Invalid pagination")
                current = f"SELECT doc,_ord FROM {base} ORDER BY _ord " + ("OFFSET " if op == "$skip" else "LIMIT ") + str(spec)
            elif op == "$count":
                current = f"SELECT jsonb_build_object({literal(spec)},count(*)) doc,1::bigint _ord FROM {base} HAVING count(*)>0"
            elif op == "$project":
                current = f"SELECT {self.project(spec)} doc,_ord FROM {base}"
            elif op in {"$set", "$addFields"}:
                expression = "doc"
                for key, value in spec.items():
                    expression = self.set_path(expression, key, self.expr(value))
                current = f"SELECT {expression} doc,_ord FROM {base}"
            elif op == "$replaceRoot":
                current = f"SELECT {self.expr(spec['newRoot'])} doc,_ord FROM {base}"
            elif op == "$lookup":
                foreign = self.schema + "." + identifier(spec["from"])
                left = self.field(spec["localField"], "q.doc")
                right = self.field(spec["foreignField"], "f.doc")
                match = f"COALESCE({left}={right},false) OR (jsonb_typeof({left})='array' AND {left} @> jsonb_build_array({right}))"
                joined = f"(SELECT COALESCE(jsonb_agg(f.doc ORDER BY f._ord),'[]'::jsonb) FROM {foreign} f WHERE {match})"
                current = f"SELECT {self.set_path('doc',spec['as'],joined)} doc,_ord FROM {base}"
            elif op == "$unwind":
                path = spec if isinstance(spec, str) else spec["path"]
                field = path.removeprefix("$")
                value = self.field(field)
                keep = isinstance(spec, dict) and spec.get("preserveNullAndEmptyArrays", False)
                array = f"CASE WHEN jsonb_typeof({value})='array' THEN {value} WHEN {value} IS NULL OR {value}='null'::jsonb THEN '[]'::jsonb ELSE jsonb_build_array({value}) END"
                join = "LEFT JOIN LATERAL" if keep else "CROSS JOIN LATERAL"
                ending = " ON true" if keep else ""
                current = f"SELECT {self.set_path('doc',field,'u.value')} doc,row_number() OVER (ORDER BY _ord,u.ordinality) _ord FROM {base} {join} jsonb_array_elements({array}) WITH ORDINALITY u{ending}"
            elif op == "$group":
                key = self.expr(spec["_id"])
                pairs = ["'_id'," + key]
                for name, accumulator in spec.items():
                    if name == "_id":
                        continue
                    kind, value = next(iter(accumulator.items()))
                    expression = self.expr(value)
                    if kind == "$sum":
                        result = f"to_jsonb(COALESCE(sum({self.number(expression)}),0))"
                    elif kind == "$first":
                        result = f"(array_agg({expression} ORDER BY _ord))[1]"
                    else:
                        raise NotImplementedError("Unsupported accumulator " + kind)
                    pairs.append(literal(name) + "," + result)
                current = f"SELECT jsonb_build_object({','.join(pairs)}) doc,min(_ord) _ord FROM {base} GROUP BY {key}"
            elif op == "$facet":
                pairs = []
                for name, pipeline in spec.items():
                    branch = self.pipeline(current, pipeline)
                    pairs.append(literal(name) + f",(SELECT COALESCE(jsonb_agg(doc ORDER BY _ord),'[]'::jsonb) FROM ({branch}) facet)")
                current = "SELECT jsonb_build_object(" + ",".join(pairs) + ") doc,1::bigint _ord"
            else:
                raise NotImplementedError("Unsupported PostgreSQL pipeline " + op)
            # Preserve stage boundaries. Otherwise PostgreSQL can inline nested
            # JSONB expressions repeatedly, especially lookup/filter/facet flows.
            name = "stage_" + str(len(self.ctes))
            self.ctes.append(name + " AS MATERIALIZED (" + current + ")")
            current = "SELECT doc,_ord FROM " + name
        return current

    def statement(self, select):
        return ("WITH " + ",".join(self.ctes) + " " if self.ctes else "") + select
