import { env, nodeless, cloudflare } from "unenv-sst";
const envConfig = env(nodeless, cloudflare, {});
import { dirname, join } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
let json = JSON.stringify(envConfig, null, 2);
json = json.replaceAll("unenv/", "unenv-sst/");
Bun.write(join(__dirname, "./unenv.json"), json);
