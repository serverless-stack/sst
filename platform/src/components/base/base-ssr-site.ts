import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { Output, Resource, all, output } from "@pulumi/pulumi";
import { Prettify } from "../component";
import { Input } from "../input";
import { Link } from "../link.js";
import { VisibleError } from "../error.js";
import { BaseSiteDev, BaseSiteFileOptions } from "./base-site";
import { Run } from "../providers/run";

export interface BaseSsrSiteArgs {
  dev?: false | Prettify<BaseSiteDev>;
  assets?: Input<{
    /**
     * Character encoding for text based assets, like HTML, CSS, JS. This is
     * used to set the `Content-Type` header when these files are served out.
     *
     * If set to `"none"`, then no charset will be returned in header.
     * @default `"utf-8"`
     * @example
     * ```js
     * {
     *   assets: {
     *     textEncoding: "iso-8859-1"
     *   }
     * }
     * ```
     */
    textEncoding?: Input<
      "utf-8" | "iso-8859-1" | "windows-1252" | "ascii" | "none"
    >;
    /**
     * The `Cache-Control` header used for versioned files, like `main-1234.css`. This is
     * used by both CloudFront and the browser cache.
     *
     * The default `max-age` is set to 1 year.
     * @default `"public,max-age=31536000,immutable"`
     * @example
     * ```js
     * {
     *   assets: {
     *     versionedFilesCacheHeader: "public,max-age=31536000,immutable"
     *   }
     * }
     * ```
     */
    versionedFilesCacheHeader?: Input<string>;
    /**
     * The `Cache-Control` header used for non-versioned files, like `index.html`. This is used by both CloudFront and the browser cache.
     *
     * The default is set to not cache on browsers, and cache for 1 day on CloudFront.
     * @default `"public,max-age=0,s-maxage=86400,stale-while-revalidate=8640"`
     * @example
     * ```js
     * {
     *   assets: {
     *     nonVersionedFilesCacheHeader: "public,max-age=0,no-cache"
     *   }
     * }
     * ```
     */
    nonVersionedFilesCacheHeader?: Input<string>;
    /**
     * Specify the `Content-Type` and `Cache-Control` headers for specific files. This allows
     * you to override the default behavior for specific files using glob patterns.
     *
     * @example
     * Apply `Cache-Control` and `Content-Type` to all zip files.
     * ```js
     * {
     *   assets: {
     *     fileOptions: [
     *       {
     *         files: "**\/*.zip",
     *         contentType: "application/zip",
     *         cacheControl: "private,no-cache,no-store,must-revalidate"
     *       }
     *     ]
     *   }
     * }
     * ```
     * Apply `Cache-Control` to all CSS and JS files except for CSS files with `index-`
     * prefix in the `main/` directory.
     * ```js
     * {
     *   assets: {
     *     fileOptions: [
     *       {
     *         files: ["**\/*.css", "**\/*.js"],
     *         ignore: "main\/index-*.css",
     *         cacheControl: "private,no-cache,no-store,must-revalidate"
     *       }
     *     ]
     *   }
     * }
     * ```
     */
    fileOptions?: Input<Prettify<BaseSiteFileOptions>[]>;
  }>;
  buildCommand?: Input<string>;
  environment?: Input<Record<string, Input<string>>>;
  link?: Input<any[]>;
  path?: Input<string>;
}

export function buildApp(
  parent: Resource,
  name: string,
  args: BaseSsrSiteArgs,
  sitePath: Output<string>,
  buildCommand?: Output<string>,
) {
  return all([
    sitePath,
    buildCommand ?? args.buildCommand,
    args.link,
    args.environment,
  ]).apply(([sitePath, userCommand, links, environment]) => {
    const cmd = resolveBuildCommand();
    const result = runBuild();
    return result.id.apply(() => sitePath);

    function resolveBuildCommand() {
      if (userCommand) return userCommand;

      // Ensure that the site has a build script defined
      if (!userCommand) {
        if (!fs.existsSync(path.join(sitePath, "package.json"))) {
          throw new VisibleError(`No package.json found at "${sitePath}".`);
        }
        const packageJson = JSON.parse(
          fs.readFileSync(path.join(sitePath, "package.json")).toString(),
        );
        if (!packageJson.scripts || !packageJson.scripts.build) {
          throw new VisibleError(
            `No "build" script found within package.json in "${sitePath}".`,
          );
        }
      }

      if (
        fs.existsSync(path.join(sitePath, "yarn.lock")) ||
        fs.existsSync(path.join($cli.paths.root, "yarn.lock"))
      )
        return "yarn run build";
      if (
        fs.existsSync(path.join(sitePath, "pnpm-lock.yaml")) ||
        fs.existsSync(path.join($cli.paths.root, "pnpm-lock.yaml"))
      )
        return "pnpm run build";
      if (
        fs.existsSync(path.join(sitePath, "bun.lockb")) ||
        fs.existsSync(path.join($cli.paths.root, "bun.lockb")) ||
        fs.existsSync(path.join(sitePath, "bun.lock")) ||
        fs.existsSync(path.join($cli.paths.root, "bun.lock"))
      )
        return "bun run build";

      return "npm run build";
    }

    function runBuild() {
      // Build link environment variables to inject
      const linkData = Link.build(links || []);
      const linkEnvs = output(linkData).apply((linkData) => {
        const envs: Record<string, string> = {
          SST_RESOURCE_App: JSON.stringify({
            name: $app.name,
            stage: $app.stage,
          }),
        };
        for (const datum of linkData) {
          envs[`SST_RESOURCE_${datum.name}`] = JSON.stringify(datum.properties);
        }
        return envs;
      });

      // Run build
      return new Run(
        `${name}Build`,
        {
          command: cmd,
          cwd: sitePath,
          env: linkEnvs.apply((linkEnvs) => ({
            SST: "1",
            ...process.env,
            ...environment,
            ...linkEnvs,
          })),
          version: Date.now().toString(),
        },
        {
          parent,
          ignoreChanges: process.env.SKIP ? ["*"] : undefined,
        },
      );
    }
  });
}
