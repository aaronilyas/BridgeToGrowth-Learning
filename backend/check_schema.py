"""Read-only compatibility preflight: never run schema upgrades on startup."""
from sqlalchemy import inspect
from .database import engine
from .models import Base


def check_schema(connection=engine):
    inspector = inspect(connection)
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            raise RuntimeError('Incompatible database schema; apply documented offline migrations in compose.md')
        columns = {column['name'] for column in inspector.get_columns(table.name)}
        if not set(table.columns.keys()).issubset(columns):
            raise RuntimeError('Incompatible database schema; apply documented offline migrations in compose.md')


if __name__ == '__main__':
    check_schema()
