# PostgreSQL with PostGIS and pgvector for Gereh managed databases (new PostgreSQL servers use it).
#   docker build --build-arg PG=17 -t registry.<apps domain>/gereh/postgres-ext:17 . && docker push …
# Build one tag per offered major version (18 … 11); set PAAS_PG_EXT_IMAGE to the repository.
# pgvector packages exist for PostgreSQL 13 and newer; older tags get PostGIS only.
ARG PG=17
ARG POSTGIS=3.5
FROM postgis/postgis:${PG}-${POSTGIS}
ARG PG=17
RUN apt-get update \
 && (apt-get install -y --no-install-recommends "postgresql-${PG}-pgvector" || echo "pgvector not packaged for PostgreSQL ${PG}") \
 && rm -rf /var/lib/apt/lists/*
