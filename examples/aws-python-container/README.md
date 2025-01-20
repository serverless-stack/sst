# ❍ Python Example with Containers

Deploy python applications using sst.

SST uses [uv](https://github.com/astral-sh/uv) to manage your python runtime. If you do not have uv installed, you can install it [here](https://docs.astral.sh/uv/getting-started/installation/). Any sst workspace package can be built and deployed to aws lambda using sst. In this example we deploy an API handler to lambda from the `functions` directory. The handler depends on shared code from the `shared` directory using uv's workspaces feature. (Note: builds currently do not tree shake so lots of workspaces can make larger builds than necessary.) We also deploy another function from `custom-dockerfile` to show how you can use a custom Dockerfile to deploy your python code.

Python functions can be deployed just like other SST functions, the only difference is that the functions themselves must be configured within a uv workspace, there is no drop-in-mode.

```typescript title="sst.config.ts"
const python = new sst.aws.Function("MyPythonFunction", {
  python: { container: true },
  handler: "functions/src/functions/api.handler",
  runtime: "python3.11",
  url: true
});
```

If you are using live lambdas for your python functions, it is recommended to specify your python version to match your Lambda runtime otherwise you may encounter issues with dependencies.

```toml title="src/pyproject.toml"
[project]
name = "aws-python"
version = "0.1.0"
description = "A SST app"
authors = [
    {name = "<your_name_here>", email = "<your_email_here>" },
]
requires-python = "==3.11.*"
```

Live lambda will locally run your python code by building the workspace and running the specified handler. You can have multiple handlers in the same workspace and have multiple workspaces in the same project.

```markdown
.
├── workspace_a
│   ├── pyproject.toml
│   └── src
│       └── workspace_a
│           ├── __init__.py
│           ├── api_a.py
│           └── api_b.py
└── workspace_b
    ├── pyproject.toml
    └── src
        └── workspace_b
            ├── __init__.py
            └── index.py
```