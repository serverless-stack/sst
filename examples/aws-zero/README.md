# SST + Zero + AWS + Drizzle

This template combines [Zero](https://zero.rocicorp.dev/), [Drizzle](https://orm.drizzle.team/) and [AWS RDS](https://aws.amazon.com/rds/).

It also comes with a Vite/React application based off of the [hello-zero](https://github.com/rocicorp/hello-zero) example provided by Zero.

To get started:

1. Install dependencies

```bash
npm i
```

2. Run the application in dev mode. This step can take a while to provision the database.

```bash
npm run dev
```

The Zero Cache will fail at this stage because the database takes time to be created. Wait for this to finish deploying before moving on.

3. While `sst dev` is running, open a new terminal session and run database migrations

```bash
cd packages/data
npm run upstream-db:push
```

If you get an error, make sure the tunnel is up and running in the other terminal. If it isn't you might need to first install the tunnel network interface:

```bash
npx sst tunnel install
```

Once that is done, restart the tunnel and repeat this step.

4. Seed the database

```bash
npm run upstream-db:seed
```

5. Build the Zero Schema

```bash
cd ../web
npm run build:zero-schema
```

6. Return to the running `sst dev` session and restart the Zero process. If this fails, try deleting the `zero.db` that got generated when this process failed earlier or try restarting dev mode.

```bash
npm run dev
```
