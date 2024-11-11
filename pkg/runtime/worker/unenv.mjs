import { env, nodeless, cloudflare } from "unenv-nightly";
const envConfig = env(nodeless, cloudflare, {});
import { dirname, join } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
Bun.write(join(__dirname, "./unenv.json"), JSON.stringify(envConfig, null, 2));
