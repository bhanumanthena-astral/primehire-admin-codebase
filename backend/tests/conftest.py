"""Shared pytest fixtures: in-memory Mongo (mongomock-motor), no Atlas needed."""

import pytest
import mongomock_motor


@pytest.fixture()
def db():
    return mongomock_motor.AsyncMongoMockClient()["testdb"]
