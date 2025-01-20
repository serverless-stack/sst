# aws-bedrock-knowledge-base

## Prerequisites

1. Install SST Tunnel

(Creating a tunnel)[https://sst.dev/docs/live/#creating-a-tunnel]

```sh
sudo sst install tunnel
```

## Deployment

1. First deploy the Vpc and Aurora RDS components. You will then need to configure RDS for the Bedrock Knowledge Base to access.

(https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.VectorDB.html#AuroraPostgreSQL.VectorDB.PreparingKB)[https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.VectorDB.html#AuroraPostgreSQL.VectorDB.PreparingKB]

2. Start the SST tunnel so you can login to the Postgres DB. Make sure you are using the database created by the Aurora component.

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

3. Create a specific schema for Bedrock.

_You can use any schema name_.

```sql
CREATE SCHEMA bedrock_integration;
```

4. Create the table for the vector embeddings.

For Titan v2 use `vector(1024)`
For Tital v1 use `vector(1536)`

_You can use any table name_.

```sql
CREATE TABLE bedrock_integration.bedrock_kb (
    id uuid PRIMARY KEY,
    embedding vector(1024),
    chunks text,
    metadata json
);
```

5. Create an index on the vector column

```sql
CREATE INDEX ON bedrock_integration.bedrock_kb USING hnsw (embedding vector_cosine_ops) WITH (ef_construction=256);
```

Now you are ready to setup and deploy the Bedrock Knowledge Base IaC.
