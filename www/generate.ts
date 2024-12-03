import * as path from "path";
import * as fs from "fs";
import * as TypeDoc from "typedoc";
import config from "./config";

process.on("uncaughtException", (err) => {
  restoreCode();
  console.error("There was an uncaught error", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason, promise) => {
  restoreCode();
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

type CliCommand = {
  name: string;
  hidden: boolean;
  description: { short: string; long?: string };
  args: {
    name: string;
    description: { short: string; long?: string };
    required: boolean;
  }[];
  flags: {
    name: string;
    description: { short: string; long?: string };
    type: "string" | "bool";
  }[];
  examples: {
    content: string;
  }[];
  children: CliCommand[];
};

type CommonError = {
  code: string;
  message: string;
  long: string[];
};

const cmd = process.argv[2];
const linkHashes = new Map<
  TypeDoc.DeclarationReflection,
  Map<TypeDoc.DeclarationReflection, string>
>();
function useLinkHashes(module: TypeDoc.DeclarationReflection) {
  const v =
    linkHashes.get(module) ?? new Map<TypeDoc.DeclarationReflection, string>();
  linkHashes.set(module, v);
  return v;
}

configureLogger();
patchCode();
if (!cmd || cmd === "components") {
  const components = await buildComponents();
  const sdks = await buildSdk();

  for (const component of components) {
    const sourceFile = component.sources![0].fileName;
    // Skip - generated into the global-config doc
    if (sourceFile.endsWith("/aws/iam-edit.ts")) continue;
    else if (sourceFile === "platform/src/global-config.d.ts") {
      const iamEditComponent = components.find((c) =>
        c.sources![0].fileName.endsWith("/aws/iam-edit.ts")
      );
      await generateGlobalConfigDoc(component, iamEditComponent!);
    } else if (sourceFile === "platform/src/config.ts") {
      await generateConfigDoc(component);
    } else if (sourceFile.endsWith("/dns.ts")) await generateDnsDoc(component);
    else if (
      sourceFile.endsWith("/aws/permission.ts") ||
      sourceFile.endsWith("/cloudflare/binding.ts")
    ) {
      await generateLinkableDoc(component);
    } else {
      const sdkName = component.name.split("/")[2];
      const sdk = sdks.find(
        (s) =>
          // ie. vector
          s.name === sdkName ||
          // ie. aws/realtime
          s.name === `aws/${sdkName}`
      );
      const sdkNamespace = sdk && useModuleOrNamespace(sdk);
      // Handle SDK modules are namespaced (ie. aws/realtime)
      await generateComponentDoc(component, sdkNamespace);
    }
  }
}
if (!cmd || cmd === "cli") await generateCliDoc();
if (!cmd || cmd === "common-errors") await generateCommonErrorsDoc();
if (!cmd || cmd === "examples") await generateExamplesDocs();
restoreCode();

function generateCliDoc() {
  const content = fs.readFileSync("cli-doc.json");
  const json = JSON.parse(content.toString()) as CliCommand;
  const outputFilePath = `src/content/docs/docs/reference/cli.mdx`;

  fs.writeFileSync(
    outputFilePath,
    [
      renderHeader("CLI", "Reference doc for the SST CLI."),
      renderSourceMessage("cmd/sst/main.go"),
      renderImports(outputFilePath),
      renderBodyBegin(),
      renderCliAbout(),
      renderCliGlobalFlags(),
      renderCliCommands(),
      renderBodyEnd(),
    ]
      .flat()
      .join("\n")
  );

  function renderCliAbout() {
    console.debug(` - about`);
    const lines = [];

    lines.push(
      ``,
      `<Section type="about">`,
      renderCliDescription(json.description),
      `</Section>`,
      ``,
      `---`
    );
    return lines;
  }

  function renderCliGlobalFlags() {
    const lines: string[] = [];
    if (!json.flags.length) return lines;

    lines.push(``, `## Global Flags`);

    for (const f of json.flags) {
      console.debug(` - global flag ${f.name}`);
      lines.push(
        ``,
        `### ${f.name}`,
        `<Segment>`,
        `<Section type="parameters">`,
        `<InlineSection>`,
        `**Type** ${renderCliFlagType(f.type)}`,
        `</InlineSection>`,
        `</Section>`,
        renderCliDescription(f.description),
        `</Segment>`
      );
    }
    return lines;
  }

  function renderCliCommands() {
    const lines: string[] = [];
    if (!json.children.length) return lines;

    lines.push(``, `## Commands`);

    for (const cmd of json.children.filter((cmd) => !cmd.hidden)) {
      console.debug(` - command ${cmd.name}`);
      lines.push(``, `### ${cmd.name}`, `<Segment>`);

      // usage
      if (!cmd.children.length) {
        lines.push(
          `<Section type="signature">`,
          '```sh frame="none"',
          `sst ${renderCliCommandUsage(cmd)}`,
          "```",
          `</Section>`
        );
      }

      // args
      if (cmd.args.length) {
        lines.push(
          ``,
          `<Section type="parameters">`,
          `#### Args`,
          ...cmd.args.flatMap((a) => [
            `- <p><code class="key">${renderCliArgName(a)}</code></p>`,
            `<p>${renderCliDescription(a.description)}</p>`,
          ]),
          `</Section>`
        );
      }

      // flags
      if (cmd.flags.length) {
        lines.push(
          ``,
          `<Section type="parameters">`,
          `#### Flags`,
          ...cmd.flags.flatMap((f) => [
            `- <p><code class="key">${f.name}</code> ${renderCliFlagType(
              f.type
            )}</p>`,
            `<p>${renderCliDescription(f.description)}</p>`,
          ]),
          `</Section>`
        );
      }

      // subcommands
      if (cmd.children.length) {
        lines.push(
          ``,
          `<Section type="parameters">`,
          `#### Subcommands`,
          ...cmd.children
            .filter((s) => !s.hidden)
            .flatMap((s) => [
              `- <p>[<code class="key">${s.name}</code>](#${cmd.name}-${s.name})</p>`,
            ]),
          `</Section>`
        );
      }

      // description
      lines.push(renderCliDescription(cmd.description), `</Segment>`);

      // subcommands details
      cmd.children
        .filter((subcmd) => !subcmd.hidden)
        .flatMap((subcmd) => {
          lines.push(
            `<NestedTitle id="${cmd.name}-${subcmd.name}" Tag="h4" parent="${cmd.name} ">${subcmd.name}</NestedTitle>`,
            `<Segment>`
          );

          // usage
          lines.push(
            `<Section type="signature">`,
            '```sh frame="none"',
            `sst ${cmd.name} ${renderCliCommandUsage(subcmd)}`,
            "```",
            `</Section>`
          );

          // subcommand args
          if (subcmd.args.length) {
            lines.push(
              `<Section type="parameters">`,
              `#### Args`,
              ...subcmd.args.flatMap((a) => [
                `- <p><code class="key">${a.name}</code></p>`,
                `<p>${renderCliDescription(a.description)}</p>`,
              ]),
              `</Section>`
            );
          }

          // subcommand flags
          if (subcmd.flags.length) {
            lines.push(
              `<Section type="parameters">`,
              `#### Flags`,
              ...subcmd.flags.flatMap((f) => [
                `- <p><code class="key">${f.name}</code></p>`,
                `<p>${renderCliDescription(f.description)}</p>`,
              ]),
              `</Section>`
            );
          }

          // subcommands description
          lines.push(renderCliDescription(subcmd.description), `</Segment>`);
        });
    }
    return lines;
  }

  function renderCliDescription(description: CliCommand["description"]) {
    return description.long ?? description.short;
  }

  function renderCliArgName(prop: CliCommand["args"][number]) {
    return `${prop.name}${prop.required ? "" : "?"}`;
  }

  function renderCliCommandUsage(command: CliCommand) {
    const parts: string[] = [];

    parts.push(command.name);
    command.args.forEach((arg) =>
      arg.required ? parts.push(`<${arg.name}>`) : parts.push(`[${arg.name}]`)
    );
    return parts.join(" ");
  }

  function renderCliFlagType(type: CliCommand["flags"][number]["type"]) {
    if (type.startsWith("[") && type.endsWith("]")) {
      return type
        .substring(1, type.length - 1)
        .split(",")
        .map((t: string) =>
          [
            `<code class="symbol">&ldquo;</code>`,
            `<code class="primitive">${t}</code>`,
            `<code class="symbol">&rdquo;</code>`,
          ].join("")
        )
        .join(`<code class="symbol"> | </code>`);
    }

    if (type === "bool") return `<code class="primitive">boolean</code>`;
    return `<code class="primitive">${type}</code>`;
  }
}

function generateCommonErrorsDoc() {
  const content = fs.readFileSync("common-errors-doc.json");
  const json = JSON.parse(content.toString()) as CommonError[];
  const outputFilePath = `src/content/docs/docs/common-errors.mdx`;

  fs.writeFileSync(
    outputFilePath,
    [
      renderHeader(
        "Common Errors",
        "A list of CLI error messages and how to fix them."
      ),
      renderSourceMessage("cmd/sst/main.go"),
      renderImports(outputFilePath),
      renderBodyBegin(),
      renderCommonErrorsAbout(),
      renderCommonErrorsErrors(),
      renderBodyEnd(),
    ]
      .flat()
      .join("\n")
  );

  function renderCommonErrorsAbout() {
    return [
      "Below is a collection of common errors you might encounter when using SST.",
      "",
      ":::tip",
      "The error messages in the CLI link to this doc.",
      ":::",
      "",
      "The error messages and descriptions in this doc are auto-generated from the CLI.",
      "",
    ];
  }

  function renderCommonErrorsErrors() {
    const lines: string[] = [];

    for (const error of json) {
      console.debug(` - command ${error.code}`);
      lines.push(
        ``,
        `---`,
        ``,
        `## ${error.code}`,
        ``,
        `> ${error.message}`,
        ``,
        ...error.long
      );
    }
    return lines;
  }

  function renderCliDescription(description: CliCommand["description"]) {
    return description.long ?? description.short;
  }

  function renderCliArgName(prop: CliCommand["args"][number]) {
    return `${prop.name}${prop.required ? "" : "?"}`;
  }

  function renderCliCommandUsage(command: CliCommand) {
    const parts: string[] = [];

    parts.push(command.name);
    command.args.forEach((arg) =>
      arg.required ? parts.push(`<${arg.name}>`) : parts.push(`[${arg.name}]`)
    );
    return parts.join(" ");
  }

  function renderCliFlagType(type: CliCommand["flags"][number]["type"]) {
    if (type.startsWith("[") && type.endsWith("]")) {
      return type
        .substring(1, type.length - 1)
        .split(",")
        .map((t: string) =>
          [
            `<code class="symbol">&ldquo;</code>`,
            `<code class="primitive">${t}</code>`,
            `<code class="symbol">&rdquo;</code>`,
          ].join("")
        )
        .join(`<code class="symbol"> | </code>`);
    }

    if (type === "bool") return `<code class="primitive">boolean</code>`;
    return `<code class="primitive">${type}</code>`;
  }
}

async function generateExamplesDocs() {
  const modules = await buildExamples();
  const outputFilePath = `src/content/docs/docs/examples.mdx`;
  fs.writeFileSync(
    outputFilePath,
    [
      renderHeader("Examples", "A collection of example apps for reference."),
      renderSourceMessage("examples/"),
      renderImports(outputFilePath),
      renderIntro(),
      ...modules.map((module) => {
        console.info(`Generating example ${module.name.split("/")[0]}...`);
        return [
          ``,
          `---`,
          renderTdComment(module.children![0].comment?.summary!),
          ...renderRunFunction(module),
          ``,
          `View the [full example](${config.github}/tree/dev/examples/${module.name.split("/")[0]
          }).`,
          ``,
        ];
      }),
    ]
      .flat()
      .join("\n")
  );

  function renderIntro() {
    return [
      `Below is a collection of example SST apps. These are available in the [\`examples/\`](${config.github}/tree/dev/examples) directory of the repo.`,
      "",
      ":::tip",
      "This doc is best viewed through the site search or through the _AI_.",
      ":::",
      "",
      "The descriptions for these examples are generated using the comments in the `sst.config.ts` of the app.",
      "",
      "#### Contributing",
      `To contribute an example or to edit one, submit a PR to the [repo](${config.github}).`,
      "Make sure to document the `sst.config.ts` in your example.",
      "",
    ];
  }

  function renderRunFunction(module: TypeDoc.DeclarationReflection) {
    const lines = fs
      .readFileSync(path.join(`../examples`, module.sources![0].fileName))
      .toString()
      .split("\n");
    const start = lines.indexOf("  async run() {");
    const end = lines.lastIndexOf("  },");
    return [
      '```ts title="sst.config.ts"',
      ...lines.slice(start + 1, end).map((l) => l.substring(4)),
      "```",
    ];
  }
}

async function generateGlobalConfigDoc(
  module: TypeDoc.DeclarationReflection,
  iamEditComponent: TypeDoc.DeclarationReflection
) {
  console.info(`Generating Global...`);
  const outputFilePath = `src/content/docs/docs/reference/global.mdx`;
  fs.writeFileSync(
    outputFilePath,
    [
      renderHeader("Global", "Reference doc for the Global `$` library."),
      renderSourceMessage("platform/src/global.d.ts"),
      renderImports(outputFilePath),
      renderBodyBegin(),
      renderAbout(useModuleComment(module)),
      renderVariables(module),
      renderFunctions(module, useModuleFunctions(module), {
        title: "Functions",
      }),
      renderFunctions(module, useModuleFunctions(iamEditComponent), {
        title: "AWS",
      }),
      renderBodyEnd(),
    ]
      .flat()
      .join("\n")
  );
}

async function generateConfigDoc(module: TypeDoc.DeclarationReflection) {
  console.info(`Generating Config...`);
  const sourceFile = module.sources![0].fileName;
  const outputFilePath = `src/content/docs/docs/reference/config.mdx`;
  fs.writeFileSync(
    outputFilePath,
    [
      renderHeader("Config", "Reference doc for the `sst.config.ts`."),
      renderSourceMessage(sourceFile),
      renderImports(outputFilePath),
      renderBodyBegin(),
      renderAbout(useModuleComment(module)),
      renderInterfacesAtH2Level(module, { filter: (c) => c.name === "Config" }),
      renderInterfacesAtH2Level(module, { filter: (c) => c.name !== "Config" }),
      renderBodyEnd(),
    ]
      .flat()
      .join("\n")
  );
}

async function generateDnsDoc(module: TypeDoc.DeclarationReflection) {
  const dnsProvider = module.name.split("/")[1];
  const sourceFile = module.sources![0].fileName;
  const outputFilePath = `src/content/docs/docs/component/${dnsProvider}/dns.mdx`;
  const title =
    {
      aws: "AWS",
      cloudflare: "Cloudflare",
      vercel: "Vercel",
    }[dnsProvider] || dnsProvider;

  const dir = path.dirname(outputFilePath);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    outputFilePath,
    [
      renderHeader(
        `${title} DNS Adapter`,
        `Reference doc for the \`sst.${dnsProvider}.dns\` adapter.`
      ),
      renderSourceMessage(sourceFile),
      renderImports(outputFilePath),
      renderBodyBegin(),
      renderAbout(useModuleComment(module)),
      renderFunctions(module, useModuleFunctions(module), {
        title: "Functions",
      }),
      renderInterfacesAtH2Level(module),
      renderBodyEnd(),
    ]
      .flat()
      .join("\n")
  );
}

async function generateLinkableDoc(module: TypeDoc.DeclarationReflection) {
  const name = module.name.split("/")[1];
  const sourceFile = module.sources![0].fileName;
  const outputFilePath = path.join(
    "src/content/docs/docs/component",
    `${module.name.split("/").slice(1).join("/")}.mdx`
  );
  const copy = {
    "components/aws/permission": {
      title: "AWS",
      namespace: "sst.aws.permission",
    },
    "components/cloudflare/binding": {
      title: "Cloudflare",
      namespace: "sst.cloudflare.binding",
    },
  }[module.name]!;

  const dir = path.dirname(outputFilePath);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    outputFilePath,
    [
      renderHeader(
        `${copy.title} Linkable helper`,
        `Reference doc for the \`${copy.namespace}\` helper.`
      ),
      renderSourceMessage(sourceFile),
      renderImports(outputFilePath),
      renderBodyBegin(),
      renderAbout(useModuleComment(module)),
      renderFunctions(module, useModuleFunctions(module), {
        title: "Functions",
      }),
      renderInterfacesAtH2Level(module),
      renderBodyEnd(),
    ]
      .flat()
      .join("\n")
  );
}

async function generateComponentDoc(
  component: TypeDoc.DeclarationReflection,
  sdk?: TypeDoc.DeclarationReflection
) {
  console.info(`Generating ${component.name}...`);
  const sourceFile = component.sources![0].fileName;
  const className = useClassName(component);
  const fullClassName = `${useClassProviderNamespace(component)}.${className}`;
  const matchRet = component.name.match(/-(v\d+)$/);
  const version = matchRet ? `.${matchRet[1]}` : "";

  // Remove leading `components/`
  // module.name = "components/aws/bucket"
  // module.name = "components/secret"
  const outputFilePath = path.join(
    "src/content/docs/docs/component",
    `${component.name.split("/").slice(1).join("/")}.mdx`
  );

  const dir = path.dirname(outputFilePath);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    outputFilePath,
    [
      renderHeader(
        useClassName(component) + version,
        `Reference doc for the \`${fullClassName + version}\` component.`
      ),
      renderSourceMessage(sourceFile),
      renderImports(outputFilePath),
      renderBodyBegin(),
      renderAbout(useClassComment(component)),
      renderConstructor(component)
        .join("\n")
        .replace(`new ${className}`, `new ${className}${version}`),
      renderInterfacesAtH2Level(component, {
        filter: (c) => c.name === `${className}Args`,
      }),
      renderProperties(component),
      ...(() => {
        const lines = [
          ...renderLinks(component),
          ...renderCloudflareBindings(component),
          ...(sdk && sdk.name === "realtime"
            ? renderAbout(useModuleComment(sdk))
            : []),
          ...(sdk
            ? renderFunctions(
              sdk,
              useModuleFunctions(sdk),
              sdk.name === "realtime" ? { prefix: sdk.name } : undefined
            )
            : []),
          ...(sdk ? renderInterfacesAtH3Level(sdk) : []),
        ];
        return lines.length
          ? [
            ``,
            `## SDK`,
            ``,
            `Use the [SDK](/docs/reference/sdk/) in your runtime to interact with your infrastructure.`,
            ``,
            `---`,
            ...lines,
          ]
          : [];
      })(),
      renderMethods(component),
      renderInterfacesAtH2Level(component, {
        filter: (c) => c.name !== `${className}Args`,
      }),
      renderBodyEnd(),
    ]
      .flat()
      .join("\n")
  );
}

/*************************/
/** Helps with rendering */
/*************************/

function renderHeader(title: string, description: string) {
  return [`---`, `title: ${title}`, `description: ${description}`, `---`];
}

function renderSourceMessage(source: string) {
  return [``, `{/* DO NOT EDIT. AUTO-GENERATED FROM "${source}" */}`];
}

function renderBodyBegin() {
  return ['<div class="tsdoc">'];
}

function renderImports(outputFilePath: string) {
  const relativePath = path.relative(outputFilePath, "src");
  return [
    ``,
    `import { Tabs, TabItem } from '@astrojs/starlight/components';`,
    `import Segment from '${relativePath}/src/components/tsdoc/Segment.astro';`,
    `import Section from '${relativePath}/src/components/tsdoc/Section.astro';`,
    `import NestedTitle from '${relativePath}/src/components/tsdoc/NestedTitle.astro';`,
    `import InlineSection from '${relativePath}/src/components/tsdoc/InlineSection.astro';`,
    "",
  ];
}

function renderTdComment(parts: TypeDoc.CommentDisplayPart[]) {
  return parts.map((part) => part.text).join("");
}

function renderBodyEnd() {
  return ["</div>"];
}

function renderType(
  module: TypeDoc.DeclarationReflection,
  type: TypeDoc.SomeType
) {
  return renderSomeType(type);

  function renderSomeType(type: TypeDoc.SomeType): string {
    if (type.type === "intrinsic") return renderIntrisicType(type);
    if (type.type === "literal") return renderLiteralType(type);
    if (type.type === "templateLiteral") return renderTemplateLiteralType(type);
    if (type.type === "union") return renderUnionType(type);
    if (type.type === "array") return renderArrayType(type);
    if (type.type === "reference" && type.package === "typescript") {
      return renderTypescriptType(type);
    }
    if (type.type === "reference" && type.package === "@sst/platform") {
      return renderSstComponentType(type);
    }
    if (type.type === "reference" && type.package === "sst") {
      return renderSstSdkType(type);
    }
    if (type.type === "reference" && type.package === "@pulumi/pulumi") {
      return renderPulumiType(type);
    }
    if (type.type === "reference" && type.package?.startsWith("@pulumi/")) {
      return renderPulumiProviderType(type);
    }
    if (type.type === "reference" && type.package === "@pulumiverse/vercel") {
      return renderVercelType(type);
    }
    if (type.type === "reference" && type.package === "@types/aws-lambda") {
      return renderAwsLambdaType(type);
    }
    if (type.type === "reference" && type.package === "esbuild") {
      return renderEsbuildType(type);
    }
    if (type.type === "reflection" && type.declaration.signatures) {
      return renderCallbackType(type);
    }
    if (type.type === "reflection" && type.declaration.children?.length) {
      return renderObjectType(type);
    }

    // @ts-expect-error
    delete type._project;
    console.log(type);
    throw new Error(`Unsupported type "${type.type}"`);
  }
  function renderIntrisicType(type: TypeDoc.IntrinsicType) {
    return `<code class="primitive">${type.name}</code>`;
  }
  function renderLiteralType(type: TypeDoc.LiteralType) {
    // Intrisic values: don't print in quotes
    // ie.
    // {
    //   "type": "literal",
    //   "value": false
    // }
    if (type.value === true || type.value === false) {
      return `<code class="primitive">${type.value}</code>`;
    }
    // String value
    // ie.
    // {
    //   "type": "literal",
    //   "value": "arm64"
    // }
    const sanitized =
      typeof type.value === "string"
        ? type.value!.replace(/([*:])/g, "\\$1")
        : type.value;
    return `<code class="symbol">&ldquo;</code><code class="primitive">${sanitized}</code><code class="symbol">&rdquo;</code>`;
  }
  function renderTemplateLiteralType(type: TypeDoc.TemplateLiteralType) {
    // ie. memory: `${number} MB`
    // {
    //   "type": "templateLiteral",
    //   "head": "",
    //   "tail": [
    //     [
    //       {
    //         "type": "intrinsic",
    //         "name": "number"
    //       },
    //       " MB"
    //     ]
    //   ]
    // },
    if (
      typeof type.head !== "string" ||
      type.tail.length !== 1 ||
      type.tail[0].length !== 2 ||
      type.tail[0][0].type !== "intrinsic" ||
      typeof type.tail[0][1] !== "string"
    ) {
      console.error(type);
      throw new Error(`Unsupported templateLiteral type`);
    }
    return `<code class="symbol">&ldquo;</code><code class="primitive">${type.head}$\\{${type.tail[0][0].name}\\}${type.tail[0][1]}</code><code class="symbol">&rdquo;</code>`;
  }
  function renderUnionType(type: TypeDoc.UnionType) {
    return type.types
      .map((t) => renderSomeType(t))
      .join(`<code class="symbol"> | </code>`);
  }
  function renderArrayType(type: TypeDoc.ArrayType) {
    return type.elementType.type === "union"
      ? `<code class="symbol">(</code>${renderSomeType(
        type.elementType
      )}<code class="symbol">)[]</code>`
      : `${renderSomeType(type.elementType)}<code class="symbol">[]</code>`;
  }
  function renderTypescriptType(type: TypeDoc.ReferenceType) {
    // ie. Record<string, string>
    return [
      `<code class="primitive">${type.name}</code>`,
      `<code class="symbol">&lt;</code>`,
      type.typeArguments?.map((t) => renderSomeType(t)).join(", "),
      `<code class="symbol">&gt;</code>`,
    ].join("");
  }
  function renderSstComponentType(type: TypeDoc.ReferenceType) {
    if (type.name === "Transform") {
      const renderedType = renderSomeType(type.typeArguments?.[0]!);
      return [
        renderedType,
        `<code class="symbol"> | </code>`,
        `<code class="symbol">(</code>`,
        `<code class="primitive">args</code>`,
        `<code class="symbol">: </code>`,
        renderedType,
        `<code class="symbol">, </code>`,
        `<code class="primitive">opts</code>`,
        `<code class="symbol">: </code>`,
        `[<code class="type">ComponentResourceOptions</code>](https://www.pulumi.com/docs/concepts/options/)`,
        `<code class="symbol">, </code>`,
        `<code class="primitive">name</code>`,
        `<code class="symbol">: </code>`,
        `<code class="primitive">string</code>`,
        `<code class="symbol">)</code>`,
        `<code class="symbol"> => </code>`,
        `<code class="primitive">void</code>`,
      ].join("");
    }
    if (type.name === "Input") {
      return [
        `<code class="primitive">${type.name}</code>`,
        `<code class="symbol">&lt;</code>`,
        renderSomeType(type.typeArguments?.[0]!),
        `<code class="symbol">&gt;</code>`,
      ].join("");
    }
    const dnsProvider = {
      AwsDns: "aws",
      CloudflareDns: "cloudflare",
      VercelDns: "vercel",
    }[type.name];
    if (dnsProvider) {
      return `[<code class="type">sst.${dnsProvider}.dns</code>](/docs/component/${dnsProvider}/dns/)`;
    }
    const linkableProvider = {
      AwsPermission: {
        doc: "aws/permission/",
        namespace: "sst.aws.permission",
      },
      CloudflareBinding: {
        doc: "cloudflare/binding/",
        namespace: "sst.cloudflare.binding",
      },
    }[type.name];
    if (linkableProvider) {
      return `[<code class="type">${linkableProvider.namespace}</code>](/docs/component/${linkableProvider.doc})`;
    }
    if (type.name === "FunctionArn") {
      return [
        '<code class="primitive">"arn:aws:lambda:$&#123;string&#125;"</code>',
      ].join("");
    }
    // types in the same doc (links to the class ie. `subscribe()` return type)
    if (isModuleComponent(module) && type.name === useClassName(module)) {
      return `[<code class="type">${type.name}</code>](.)`;
    }
    // types in the same doc (links to an interface)
    if (useModuleInterfaces(module).find((i) => i.name === type.name)) {
      return `[<code class="type">${type.name
        }</code>](#${type.name.toLowerCase()})`;
    }
    // types in different doc
    const externalModule = {
      ApiGatewayV1Authorizer: "apigatewayv1-authorizer",
      ApiGatewayV1IntegrationArgs: "apigatewayv1",
      ApiGatewayV1IntegrationRoute: "apigatewayv1-integration-route",
      ApiGatewayV1LambdaRoute: "apigatewayv1-lambda-route",
      ApiGatewayV2Authorizer: "apigatewayv2-authorizer",
      ApiGatewayV2LambdaRoute: "apigatewayv2-lambda-route",
      ApiGatewayV2PrivateRoute: "apigatewayv2-private-route",
      ApiGatewayV2UrlRoute: "apigatewayv2-url-route",
      ApiGatewayWebSocketRoute: "apigateway-websocket-route",
      AppSyncDataSource: "app-sync-data-source",
      AppSyncFunction: "app-sync-function",
      AppSyncResolver: "app-sync-resolver",
      Bucket: "bucket",
      BucketArgs: "bucket",
      BucketLambdaSubscriber: "bucket-lambda-subscriber",
      BucketQueueSubscriber: "bucket-queue-subscriber",
      BucketTopicSubscriber: "bucket-topic-subscriber",
      Cdn: "cdn",
      CdnArgs: "cdn",
      CognitoIdentityProvider: "cognito-identity-provider",
      CognitoUserPoolClient: "cognito-user-pool-client",
      DynamoLambdaSubscriber: "dynamo-lambda-subscriber",
      Efs: "efs",
      Function: "function",
      FunctionArgs: "function",
      FunctionPermissionArgs: "function",
      Postgres: "postgres",
      PostgresArgs: "postgres",
      Queue: "queue",
      QueueLambdaSubscriber: "queue-lambda-subscriber",
      KinesisStreamLambdaSubscriber: "kinesis-stream-lambda-subscriber",
      RealtimeLambdaSubscriber: "realtime-lambda-subscriber",
      Service: "service",
      SnsTopicLambdaSubscriber: "sns-topic-lambda-subscriber",
      SnsTopicQueueSubscriber: "sns-topic-queue-subscriber",
      Vpc: "vpc",
    }[type.name];
    if (externalModule) {
      const hash = type.name.endsWith("Args")
        ? `#${type.name.toLowerCase()}`
        : "";
      return `[<code class="type">${type.name}</code>](/docs/component/aws/${externalModule}/${hash})`;
    }
    if (type.name === "Resource" || type.name === "Constructor") {
      return `<code class="type">${type.name}</code>`;
    }

    // @ts-expect-error
    delete type._project;
    console.error(type);
    throw new Error(`Unsupported SST component type`);
  }
  function renderSstSdkType(type: TypeDoc.ReferenceType) {
    // types in the same doc (links to an interface)
    if (useModuleInterfaces(module).find((i) => i.name === type.name)) {
      return `[<code class="type">${type.name
        }</code>](#${type.name.toLowerCase()})`;
    } else if (type.name === "T") {
      return `<code class="primitive">string</code>`;
    }

    // @ts-expect-error
    delete type._project;
    console.error(type);
    throw new Error(`Unsupported SST SDK type`);
  }
  function renderPulumiType(type: TypeDoc.ReferenceType) {
    if (type.name === "T") {
      return `<code class="primitive">${type.name}</code>`;
    }
    if (
      type.name === "Output" ||
      type.name === "OutputInstance" ||
      type.name === "Input"
    ) {
      const typeName = type.name === "OutputInstance" ? "Output" : type.name;
      return [
        `<code class="primitive">${typeName}</code>`,
        `<code class="symbol">&lt;</code>`,
        renderSomeType(type.typeArguments?.[0]!),
        `<code class="symbol">&gt;</code>`,
      ].join("");
    }
    if (type.name === "UnwrappedObject" || type.name === "Unwrap") {
      return renderSomeType(type.typeArguments?.[0]!);
    }
    if (type.name === "ComponentResourceOptions") {
      return `[<code class="type">${type.name}</code>](https://www.pulumi.com/docs/concepts/options/)`;
    }
    if (type.name === "FileAsset") {
      return `[<code class="type">${type.name}</code>](https://www.pulumi.com/docs/iac/concepts/assets-archives/#assets)`;
    }
    if (type.name === "FileArchive") {
      return `[<code class="type">${type.name}</code>](https://www.pulumi.com/docs/iac/concepts/assets-archives/#archives)`;
    }
    // Handle $util type in global.d.ts
    if (type.name === "__module") {
      return `[<code class="type">@pulumi/pulumi</code>](https://www.pulumi.com/docs/reference/pkg/nodejs/pulumi/pulumi/)`;
    }

    // @ts-expect-error
    delete type._project;
    console.error(type);
    throw new Error(`Unsupported @pulumi/pulumi type`);
  }
  function renderPulumiProviderType(type: TypeDoc.ReferenceType) {
    const ret = ((type as any)._target.fileName as string).match(
      "node_modules/@pulumi/([^/]+)/(.+).d.ts"
    )!;
    const provider = ret[1].toLocaleLowerCase(); // ie. aws
    const cls = ret[2].toLocaleLowerCase(); // ie. s3/Bucket
    if (cls === "types/input") {
      // Input types
      // ie. errorResponses?: aws.types.input.cloudfront.DistributionCustomErrorResponse[];
      //{
      //  type: 'reference',
      //  refersToTypeParameter: false,
      //  preferValues: false,
      //  name: 'DistributionCustomErrorResponse',
      //  _target: ReflectionSymbolId {
      //    fileName: '/Users/frank/Sites/ion/platform/node_modules/@pulumi/aws/types/input.d.ts',
      //    qualifiedName: 'cloudfront.DistributionCustomErrorResponse',
      //    pos: 427276,
      //    transientId: NaN
      //  },
      //  qualifiedName: 'cloudfront.DistributionCustomErrorResponse',
      //  package: '@pulumi/aws',
      //  typeArguments: undefined
      //}
      const link = {
        DistributionOrigin: "cloudfront/distribution",
        DistributionOriginGroup: "cloudfront/distribution",
        DistributionCustomErrorResponse: "cloudfront/distribution",
        DistributionDefaultCacheBehavior: "cloudfront/distribution",
        DistributionOrderedCacheBehavior: "cloudfront/distribution",
      }[type.name];
      if (!link) {
        // @ts-expect-error
        delete type._project;
        console.error(type);
        throw new Error(`Unsupported @pulumi provider input type`);
      }
      return `[<code class="type">${type.name
        }</code>](https://www.pulumi.com/registry/packages/${provider}/api-docs/${link}/#${type.name.toLowerCase()})`;
    } else if (cls.startsWith("types/")) {
      console.error(type);
      throw new Error(`Unsupported @pulumi provider class type`);
    } else {
      // Resource types
      // ie. bucket?: aws.s3.BucketV2;
      //{
      //  type: 'reference',
      //  refersToTypeParameter: false,
      //  preferValues: false,
      //  name: 'BucketV2',
      //  _target: ReflectionSymbolId {
      //    fileName: '/Users/frank/Sites/ion/platform/node_modules/@pulumi/aws/s3/bucketV2.d.ts',
      //    qualifiedName: 'BucketV2',
      //    pos: 127,
      //    transientId: NaN
      //  },
      //  qualifiedName: 'BucketV2',
      //  package: '@pulumi/aws',
      //  typeArguments: []
      //}
    }
    const hash = type.name.endsWith("Args") ? `#inputs` : "";
    return `[<code class="type">${type.name}</code>](https://www.pulumi.com/registry/packages/${provider}/api-docs/${cls}/${hash})`;
  }
  function renderAwsLambdaType(type: TypeDoc.ReferenceType) {
    const ret = ((type as any)._target.fileName as string).match(
      "node_modules/@types/aws-lambda/(.+)"
    )!;
    const filePath = ret[1];
    // Resource types
    //{
    //  type: 'reference',
    //  refersToTypeParameter: false,
    //  preferValues: false,
    //  name: 'IoTCustomAuthorizerHandler',
    //  _target: ReflectionSymbolId {
    //    fileName: '/Users/frank/Sites/ion/node_modules/@types/aws-lambda/trigger/iot-authorizer.d.ts',
    //    qualifiedName: 'IoTCustomAuthorizerHandler',
    //    pos: 152,
    //    transientId: NaN
    //  },
    //  qualifiedName: 'IoTCustomAuthorizerHandler',
    //  package: '@types/aws-lambda',
    //  typeArguments: undefined
    //}
    return `[<code class="type">${type.name}</code>](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/aws-lambda/${filePath})`;
  }
  function renderVercelType(type: TypeDoc.ReferenceType) {
    const ret = ((type as any)._target.fileName as string).match(
      "node_modules/@pulumiverse/([^/]+)/(.+).d.ts"
    )!;
    const provider = ret[1].toLocaleLowerCase(); // ie. vercel
    const cls = ret[2].toLocaleLowerCase(); // ie. dnsRecord
    // Resource types
    //{
    //  type: 'reference',
    //  name: 'DnsRecord',
    //  _target: ReflectionSymbolId {
    //    fileName: '/Users/frank/Sites/ion/node_modules/@pulumiverse/vercel/dnsRecord.d.ts',
    //    qualifiedName: 'DnsRecord',
    //    pos: 125,
    //    transientId: NaN
    //  },
    //  qualifiedName: 'DnsRecord',
    //  package: '@pulumiverse/vercel',
    //}
    const hash = type.name.endsWith("Args") ? `#inputs` : "";
    return `[<code class="type">${type.name}</code>](https://www.pulumi.com/registry/packages/${provider}/api-docs/${cls}/${hash})`;
  }
  function renderEsbuildType(type: TypeDoc.ReferenceType) {
    const hash = type.name === "Loader" ? `#loader` : "#build";
    return `[<code class="type">${type.name}</code>](https://esbuild.github.io/api/${hash})`;
  }
  function renderCallbackType(type: TypeDoc.ReflectionType) {
    const signature = type.declaration.signatures![0];
    const parameters = (signature.parameters ?? [])
      .map(
        (parameter) =>
          `${renderSignatureArg(parameter)}: ${renderSomeType(parameter.type!)}`
      )
      .join(", ");
    return `<code class="primitive">(${parameters}) => ${renderSomeType(
      signature.type!
    )}</code>`;
  }
  function renderObjectType(type: TypeDoc.ReflectionType) {
    return `<code class="primitive">Object</code>`;
  }
}

function renderVariables(module: TypeDoc.DeclarationReflection) {
  const lines: string[] = [];
  const vars = (module.children ?? []).filter(
    (c) =>
      c.kind === TypeDoc.ReflectionKind.Variable &&
      !c.comment?.modifierTags.has("@internal")
  );

  if (!vars.length) return lines;

  // $app's type is Simplify<$APP>, and there's no way to get the flattened type
  // in TypeDoc. So we'll replace $app's type with the $APP interface.
  const type$app = vars.find((v) => v.name === "$app");
  const interface$app = useModuleInterfaces(module).find(
    (i) => i.name === "$APP"
  );
  if (type$app && interface$app) {
    // @ts-expect-error
    type$app.type = {
      type: "reflection",
      declaration: interface$app,
    };
  }

  lines.push(``, `## Variables`);

  for (const v of vars) {
    console.debug(` - variable ${v.name}`);
    lines.push(
      ``,
      `### ${renderName(v)}`,
      `<Segment>`,
      `<Section type="parameters">`,
      `<InlineSection>`,
      `**Type** ${renderType(module, v.type!)}`,
      `</InlineSection>`,
      ...renderNestedTypeList(module, v),
      `</Section>`,
      ...renderDescription(v),
      ...renderExamples(v),
      `</Segment>`,
      // nested props (ie. `.nodes`)
      ...useNestedTypes(v.type!, v.name).flatMap(
        ({ depth, prefix, subType }) => [
          `<NestedTitle id="${useLinkHashes(module).get(subType)}" Tag="${depth === 0 ? "h4" : "h5"
          }" parent="${prefix}.">${renderName(subType)}</NestedTitle>`,
          `<Segment>`,
          `<Section type="parameters">`,
          `<InlineSection>`,
          `**Type** ${renderType(module, subType.type!)}`,
          `</InlineSection>`,
          `</Section>`,
          ...renderDescription(subType),
          `</Segment>`,
        ]
      )
    );
  }
  return lines;
}

function renderFunctions(
  module: TypeDoc.DeclarationReflection,
  fns: TypeDoc.DeclarationReflection[],
  opts?: { title?: string; prefix?: string }
) {
  const lines: string[] = [];

  if (!fns.length) return lines;

  if (opts?.title) lines.push(``, `## ${opts?.title}`);

  for (const f of fns) {
    console.debug(` - function ${f.name}`);
    lines.push(``, `### ${renderName(f)}`, `<Segment>`);

    // signature
    lines.push(
      `<Section type="signature">`,
      "```ts",
      (opts?.prefix ? `${opts.prefix}.` : "") +
      renderSignature(f.signatures![0]),
      "```",
      `</Section>`
    );

    // parameters
    if (f.signatures![0].parameters?.length) {
      lines.push(
        ``,
        `<Section type="parameters">`,
        `#### Parameters`,
        ...f.signatures![0].parameters.flatMap((param) => {
          let type;
          // HACK: special handle for $jsonParse's reviver param b/c
          //       it's a function type.
          if (f.name === "$jsonParse" && param.name === "reviver") {
            type = renderJsonParseReviverType();
          } else if (f.name === "$jsonStringify" && param.name === "replacer") {
            type = renderJsonStringifyReplacerType();
          } else if (f.name === "$transform" && param.name === "resource") {
            type = renderTransformResourceType();
          } else if (f.name === "$transform" && param.name === "cb") {
            type = renderTransformCallbackType();
          } else {
            type = renderType(module, param.type!);
          }

          return [
            `- <p><code class="key">${renderSignatureArg(
              param
            )}</code> ${type}</p>`,
            ...renderDescription(param),
          ];
        }),
        `</Section>`
      );
    }

    lines.push(
      ...renderReturnValue(module, f.signatures![0]),
      ...renderDescription(f.signatures![0]),
      ``,
      ...renderExamples(f.signatures![0]),
      `</Segment>`
    );
  }
  return lines;
}

function renderAbout(comment: TypeDoc.Comment) {
  console.debug(` - about`);
  const lines = [];

  lines.push(``, `<Section type="about">`);

  // description
  lines.push(renderTdComment(comment.summary));

  // examples
  const examples = comment.blockTags.filter((tag) => tag.tag === "@example");
  if (examples.length) {
    lines.push(
      ``,
      ...examples.map((example) => renderTdComment(example.content))
    );
  }

  lines.push(`</Section>`, ``, `---`);
  return lines;
}

function renderConstructor(module: TypeDoc.DeclarationReflection) {
  console.debug(` - constructor`);
  const lines = [];
  const signature = useClassConstructor(module).signatures![0];

  lines.push(``, `## Constructor`, ``, `<Segment>`);

  // signature
  lines.push(
    `<Section type="signature">`,
    "```ts",
    renderSignature(signature),
    "```",
    `</Section>`
  );

  // parameters
  if (signature.parameters?.length) {
    lines.push(
      ``,
      `<Section type="parameters">`,
      `#### Parameters`,
      ...signature.parameters.flatMap((param) => [
        `- <p><code class="key">${renderSignatureArg(
          param
        )}</code> ${renderType(module, param.type!)}</p>`,
        ...renderDescription(param),
      ]),
      `</Section>`
    );
  }

  lines.push(`</Segment>`);
  return lines;
}

function renderMethods(module: TypeDoc.DeclarationReflection) {
  const lines: string[] = [];
  const methods = useClassMethods(module);
  if (!methods?.length) return lines;

  return [
    ``,
    `## Methods`,
    ...methods.flatMap((m) =>
      renderMethod(module, m, {
        methodTitle: `### ${m.flags.isStatic ? "static " : ""}${renderName(m)}`,
        parametersTitle: `#### Parameters`,
      })
    ),
  ];
}

function renderMethod(
  module: TypeDoc.DeclarationReflection,
  method: TypeDoc.DeclarationReflection,
  opts: { methodTitle: string; parametersTitle: string }
) {
  if (method.kind !== TypeDoc.ReflectionKind.Method) return [];
  const lines = [];
  lines.push(
    ``,
    opts.methodTitle,
    `<Segment>`,
    `<Section type="signature">`,
    "```ts",
    (method.flags.isStatic ? `${useClassName(module)}.` : "") +
    renderSignature(method.signatures![0]),
    "```",
    `</Section>`
  );

  // parameters
  if (method.signatures![0].parameters?.length) {
    lines.push(
      ``,
      `<Section type="parameters">`,
      opts.parametersTitle,
      ...method.signatures![0].parameters.flatMap((param) => [
        `- <p><code class="key">${renderSignatureArg(
          param
        )}</code> ${renderType(module, param.type!)}</p>`,
        ...renderDescription(param),
      ]),
      `</Section>`
    );
  }

  lines.push(
    ...renderReturnValue(module, method.signatures![0]),
    ...renderDescription(method.signatures![0]),
    ``,
    ...renderExamples(method.signatures![0]),
    `</Segment>`
  );
  return lines;
}

function renderProperties(module: TypeDoc.DeclarationReflection) {
  const lines: string[] = [];
  const getters = useClassGetters(module);
  if (!getters.length) return lines;

  lines.push(``, `## Properties`);

  for (const g of getters) {
    console.debug(` - property ${g.name}`);
    lines.push(
      ``,
      `### ${renderName(g)}`,
      `<Segment>`,
      `<Section type="parameters">`,
      `<InlineSection>`,
      `**Type** ${renderType(module, g.getSignature!.type!)}`,
      `</InlineSection>`,
      ...renderNestedTypeList(module, g.getSignature!),
      `</Section>`,
      ...renderDescription(g.getSignature!),
      `</Segment>`,
      // nested props (ie. `.nodes`)
      ...useNestedTypes(g.getSignature!.type!, g.name).flatMap(
        ({ depth, prefix, subType }) => [
          `<NestedTitle id="${useLinkHashes(module).get(subType)}" Tag="${depth === 0 ? "h4" : "h5"
          }" parent="${prefix}.">${renderName(subType)}</NestedTitle>`,
          `<Segment>`,
          `<Section type="parameters">`,
          `<InlineSection>`,
          `**Type** ${subType.kind === TypeDoc.ReflectionKind.Property
            ? renderType(module, subType.type!)
            : renderType(module, subType.getSignature!.type!)
          }`,
          `</InlineSection>`,
          `</Section>`,
          ...(subType.kind === TypeDoc.ReflectionKind.Property
            ? renderDescription(subType)
            : renderDescription(subType.getSignature!)),
          `</Segment>`,
        ]
      )
    );
  }
  return lines;
}

function renderLinks(module: TypeDoc.DeclarationReflection) {
  const lines: string[] = [];
  const method = useClassMethodByName(module, "getSSTLink");
  if (!method) return lines;

  // Get `getSSTLink()` return type
  const returnType = method.signatures![0].type as TypeDoc.ReflectionType;
  if (!returnType.declaration) return lines;

  // Get `getSSTLink().properties` type
  const properties = returnType.declaration.children?.find(
    (c) => c.name === "properties"
  );
  if (!properties) return lines;

  // Filter out private `properties`
  const propertiesType = properties.type as TypeDoc.ReflectionType;
  if (propertiesType.declaration === undefined) {
    console.log(properties);
  }
  const links = (propertiesType.declaration.children || []).filter(
    (c) => !c.comment?.modifierTags.has("@internal")
  );
  if (!links.length) return lines;

  lines.push(
    ``,
    `### Links`,
    `This is accessible through the \`Resource\` object in the [SDK](/docs/reference/sdk/#links).`,
    `<Segment>`,
    `<Section type="parameters">`,
    ...links.flatMap((link) => {
      console.debug(` - link ${link.name}`);

      let linkType: TypeDoc.SomeType | undefined;

      // Convert Output<T> => T
      if (
        link.type &&
        link.type.type === "reference" &&
        (link.type.name === "Output" || link.type.name === "OutputInstance") &&
        (link.type.typeArguments![0].type === "intrinsic" ||
          link.type.typeArguments![0].type === "union")
      ) {
        linkType = link.type.typeArguments![0];
      } // Convert Output<T> | undefined => T | undefined
      else if (link.type && link.type.type === "union") {
        linkType = link.type;
        linkType.types = linkType.types.map((t) =>
          t.type === "reference" &&
            (t.name === "Output" || t.name === "OutputInstance")
            ? t.typeArguments![0]
            : t
        );
      }

      if (!linkType) {
        // @ts-expect-error
        delete link.type._project;
        console.error(link.type);
        throw new Error(
          `Failed to render link ${link.name} b/c link value does not match type \`Output<intrinsic>\`, \`Output<intrinsic | undefined>\`, or \`Output<intrinsic> | undefined\``
        );
      }

      // Find the getter property that matches the link name
      const getter = useClassGetters(module).find((g) => g.name === link.name);
      if (!getter) {
        throw new Error(
          `Failed to render link ${link.name} b/c cannot find a getter property with the matching name`
        );
      }

      return [
        `- <p><code class="key">${renderName(link)}</code> ${renderType(
          module,
          linkType
        )}</p>`,
        "", // Needed to indent the description
        ...renderDescription(getter.getSignature!, { indent: true }),
      ];
    }),
    `</Section>`,
    `</Segment>`
  );

  return lines;
}

function renderCloudflareBindings(module: TypeDoc.DeclarationReflection) {
  const lines: string[] = [];
  const method = useClassMethodByName(module, "getSSTLink");
  if (!method) return lines;

  // Get `getSSTLink()` return type
  const returnType = method.signatures![0].type as TypeDoc.ReflectionType;
  if (!returnType.declaration) return lines;

  // Get `getSSTLink().include` type
  const include = returnType.declaration.children?.find(
    (c) => c.name === "include"
  );
  if (!include) return lines;

  // Filter out `getSSTLink().include[].type` is `cloudflare.binding`
  const includeArrayType = include.type as TypeDoc.ArrayType;
  const includeType = includeArrayType.elementType as TypeDoc.ReflectionType;
  const isCloudflareBinding = includeType.declaration.children?.some(
    (c) =>
      c.name === "type" &&
      (c.type as TypeDoc.LiteralType)?.value === "cloudflare.binding"
  );
  if (!isCloudflareBinding) return lines;

  lines.push(
    ``,
    `### Bindings`,
    `<Segment>`,
    ...renderDescription(method.signatures![0]),
    ``,
    ...renderExamples(method.signatures![0]),
    `</Segment>`
  );

  return lines;
}

function renderInterfacesAtH2Level(
  module: TypeDoc.DeclarationReflection,
  opts: {
    filter?: (c: TypeDoc.DeclarationReflection) => boolean;
  } = {}
) {
  const lines: string[] = [];
  const interfaces = useModuleInterfaces(module)
    .filter((c) => !c.comment?.modifierTags.has("@internal"))
    .filter((c) => !opts.filter || opts.filter(c));

  for (const int of interfaces) {
    console.debug(` - interface ${int.name}`);
    // interface name
    lines.push(``, `## ${int.name}`);

    // description
    if (int.comment?.summary) {
      lines.push(``, renderTdComment(int.comment?.summary!));
    }

    // props
    for (const prop of useInterfaceProps(int)) {
      if (prop.kind === TypeDoc.ReflectionKind.Property) {
        console.debug(`   - interface prop ${prop.name}`);
        lines.push(
          `### ${renderName(prop)}`,
          `<Segment>`,
          `<Section type="parameters">`,
          `<InlineSection>`,
          `**Type** ${renderType(module, prop.type!)}`,
          `</InlineSection>`,
          ...renderNestedTypeList(module, prop),
          `</Section>`,
          ...renderDefaultTag(module, prop),
          ...renderDescription(prop),
          ``,
          ...renderExamples(prop),
          `</Segment>`,
          // nested props (ie. `.domain`, `.transform`)
          ...useNestedTypes(prop.type!, prop.name).flatMap(
            ({ depth, prefix, subType }) => {
              return subType.kind === TypeDoc.ReflectionKind.Method
                ? renderMethod(module, subType, {
                  methodTitle: `<NestedTitle id="${useLinkHashes(module).get(
                    subType
                  )}" Tag="${depth === 0 ? "h4" : "h5"
                    }" parent="${prefix}.">${renderName(
                      subType
                    )}</NestedTitle>`,
                  parametersTitle: `**Parameters**`,
                })
                : [
                  `<NestedTitle id="${useLinkHashes(module).get(
                    subType
                  )}" Tag="${depth === 0 ? "h4" : "h5"
                  }" parent="${prefix}.">${renderName(
                    subType
                  )}</NestedTitle>`,
                  `<Segment>`,
                  `<Section type="parameters">`,
                  `<InlineSection>`,
                  `**Type** ${renderType(module, subType.type!)}`,
                  `</InlineSection>`,
                  `</Section>`,
                  ...renderDefaultTag(module, subType),
                  ...renderDescription(subType),
                  ``,
                  ...renderExamples(subType),
                  `</Segment>`,
                ];
            }
          )
        );
      } else if (prop.kind === TypeDoc.ReflectionKind.Method) {
        console.debug(`   - interface method ${prop.name}`);
        lines.push(
          ...renderMethod(module, prop, {
            methodTitle: `### ${prop.flags.isStatic ? "static " : ""
              }${renderName(prop)}`,
            parametersTitle: `#### Parameters`,
          })
        );
      }
    }
  }

  return lines;
}

function renderInterfacesAtH3Level(module: TypeDoc.DeclarationReflection) {
  const lines: string[] = [];
  const interfaces = useModuleInterfaces(module).filter(
    (c) => !c.comment?.modifierTags.has("@internal")
  );

  // props
  //for (const prop of useInterfaceProps(int)) {
  for (const i of interfaces) {
    // fake interface as an Object type so we can reuse the nested type logic
    const int = {
      name: i.name,
      type: { type: "reflection", declaration: i },
    } as TypeDoc.DeclarationReflection;
    console.debug(` - interface ${int.name}`);
    lines.push(
      `### ${int.name}`,
      `<Segment>`,
      `<Section type="parameters">`,
      `<InlineSection>`,
      `**Type** ${renderType(module, int.type!)}`,
      `</InlineSection>`,
      ...renderNestedTypeList(module, int),
      `</Section>`,
      `</Segment>`,
      // nested props (ie. `.domain`, `.transform`)
      ...useNestedTypes(int.type!, int.name).flatMap(
        ({ depth, prefix, subType }) => [
          `<NestedTitle id="${useLinkHashes(module).get(subType)}" Tag="${depth === 0 ? "h4" : "h5"
          }" parent="${prefix}.">${renderName(subType)}</NestedTitle>`,
          `<Segment>`,
          `<Section type="parameters">`,
          `<InlineSection>`,
          `**Type** ${renderType(module, subType.type!)}`,
          `</InlineSection>`,
          `</Section>`,
          ...renderDefaultTag(module, subType),
          ...renderDescription(subType),
          ``,
          ...renderExamples(subType),
          `</Segment>`,
        ]
      )
    );
  }

  return lines;
}

function renderName(prop: TypeDoc.DeclarationReflection) {
  return `${prop.name}${prop.flags.isOptional ? "?" : ""}`;
}

function renderSignatureArg(prop: TypeDoc.ParameterReflection) {
  if (prop.defaultValue && prop.defaultValue !== "{}") {
    throw new Error(
      [
        `Unsupported default value "${prop.defaultValue}" for name "${prop.name}".`,
        ``,
        `Function signature parameters can be defined as optional in one of two ways:`,
        ` - flag.isOptional is set, ie. "(args?: FooArgs)"`,
        ` - defaultValue is set, ie. "(args: FooArgs = {})`,
        ``,
        `But in this case, the default value is not "{}". Hence not supported.`,
      ].join("\n")
    );
  }

  return `${prop.name}${prop.flags.isOptional || prop.defaultValue ? "?" : ""}`;
}

function renderDescription(
  prop:
    | TypeDoc.DeclarationReflection
    | TypeDoc.ParameterReflection
    | TypeDoc.SignatureReflection,
  opts?: { indent: true }
) {
  if (!prop.comment?.summary) return [];
  const str = renderTdComment(prop.comment?.summary);
  return opts?.indent
    ? [
      str
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    ]
    : [str];
}

function renderDefaultTag(
  module: TypeDoc.DeclarationReflection,
  prop: TypeDoc.DeclarationReflection
) {
  const defaultTag = prop.comment?.blockTags.find(
    (tag) => tag.tag === "@default"
  );
  if (!defaultTag) return [];
  return [
    ``,
    `<InlineSection>`,
    // If default tag is just a value, render it as a type ie. false
    // Otherwise render it as a comment ie. No domains configured
    defaultTag.content.length === 1 && defaultTag.content[0].kind === "code"
      ? `**Default** ${renderType(module, {
        type: "intrinsic",
        name: defaultTag.content[0].text
          .replace(/`/g, "")
          .replace(/{/g, "&lcub;")
          .replace(/}/g, "&rcub;"),
      } as TypeDoc.SomeType)}`
      : `**Default** ${renderTdComment(defaultTag.content)}`,
    `</InlineSection>`,
  ];
}

function renderReturnValue(
  module: TypeDoc.DeclarationReflection,
  prop: TypeDoc.SignatureReflection
) {
  return [
    ``,
    `<InlineSection>`,
    `**Returns** ${renderType(module, prop.type!)}`,
    `</InlineSection>`,
  ];
}

function renderNestedTypeList(
  module: TypeDoc.DeclarationReflection,
  prop: TypeDoc.DeclarationReflection | TypeDoc.SignatureReflection
) {
  return useNestedTypes(prop.type!, prop.name).map(
    ({ depth, prefix, subType }) => {
      const hasChildren =
        subType.kind === TypeDoc.ReflectionKind.Property
          ? useNestedTypes(subType.type!).length
          : subType.kind === TypeDoc.ReflectionKind.Method
            ? useNestedTypes(subType.signatures![0].type!).length
            : useNestedTypes(subType.getSignature?.type!).length;
      const type = hasChildren ? ` ${renderType(module, subType.type!)}` : "";
      const generateHash = (counter = 0): string => {
        const hash =
          `${prefix}.${subType.name}`
            .toLowerCase()
            .replace(/[^a-z0-9\.]/g, "")
            .replace(/\./g, "-") + (counter > 0 ? `-${counter}` : "");
        return Array.from(useLinkHashes(module).values()).includes(hash)
          ? generateHash(counter + 1)
          : hash;
      };
      const hash = generateHash();
      useLinkHashes(module).set(subType, hash);
      return `${" ".repeat(depth * 2)}- <p>[<code class="key">${renderName(
        subType
      )}</code>](#${hash})${type}</p>`;
    }
  );
}

function renderExamples(
  prop: TypeDoc.DeclarationReflection | TypeDoc.SignatureReflection
) {
  return (prop.comment?.blockTags ?? [])
    .filter((tag) => tag.tag === "@example")
    .flatMap((tag) => renderTdComment(tag.content));
}

function renderSignature(signature: TypeDoc.SignatureReflection) {
  const parameters = (signature.parameters ?? [])
    .map(renderSignatureArg)
    .join(", ");
  return `${signature.name}(${parameters})`;
}
function renderJsonParseReviverType() {
  return `[<code class="type">JSON.parse reviver</code>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse#reviver)`;
}
function renderJsonStringifyReplacerType() {
  return `[<code class="type">JSON.stringify replacer</code>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#replacer)`;
}
function renderTransformResourceType() {
  return `<code class="type">Component Class</code>`;
}
function renderTransformCallbackType() {
  return `<code class="type">(args, opts) => void</code>`;
}

/***************************************/
/** Helps with parsing TypeDoc objects */
/***************************************/

function isModuleComponent(module: TypeDoc.DeclarationReflection) {
  const sourceFile = module.sources![0].fileName;
  return (
    sourceFile !== "platform/src/config.ts" &&
    sourceFile !== "platform/src/global-config.d.ts" &&
    !sourceFile.endsWith("/dns.ts") &&
    !sourceFile.endsWith("/aws/permission.ts") &&
    !sourceFile.endsWith("/cloudflare/binding.ts")
  );
}
function useModuleComment(module: TypeDoc.DeclarationReflection) {
  const comment = module.comment;
  if (!comment) throw new Error("Class comment not found");
  return comment;
}
function useModuleInterfaces(module: TypeDoc.DeclarationReflection) {
  return module.getChildrenByKind(TypeDoc.ReflectionKind.Interface);
}
function useModuleFunctions(module: TypeDoc.DeclarationReflection) {
  return module
    .getChildrenByKind(TypeDoc.ReflectionKind.Function)
    .filter((f) => !f.signatures![0].comment?.modifierTags.has("@internal"));
}
function useModuleOrNamespace(module: TypeDoc.DeclarationReflection) {
  // Handle SDK modules are namespaced (ie. aws/realtime)
  const namespaces = module.getChildrenByKind(TypeDoc.ReflectionKind.Namespace);
  return namespaces.length ? namespaces[0] : module;
}
function useClass(module: TypeDoc.DeclarationReflection) {
  const c = module.getChildrenByKind(TypeDoc.ReflectionKind.Class);
  if (!c.length) throw new Error("Class not found");
  return c[0];
}
function useClassName(module: TypeDoc.DeclarationReflection) {
  return useClass(module).name;
}
function useClassProviderNamespace(module: TypeDoc.DeclarationReflection) {
  // "sources": [
  //   {
  //     "fileName": "platform/src/components/aws/astro.ts",
  //     "line": 280,
  //     "character": 13,
  //     "url": "https://github.com/sst/ion/blob/0776cea/platform/src/components/aws/astro.ts#L280"
  //   }
  // ],
  const fileName = useClass(module).sources![0].fileName;
  if (!fileName.startsWith("platform/src/components/")) {
    throw new Error(
      `Fail to generate class namespace from class fileName ${fileName}. Expected to start with "platform/src/components/"`
    );
  }

  const namespace = fileName.split("/").slice(-2, -1)[0];
  return namespace === "components" ? "sst" : `sst.${namespace}`;
}
function useClassComment(module: TypeDoc.DeclarationReflection) {
  const comment = useClass(module).comment;
  if (!comment) throw new Error("Class comment not found");
  return comment;
}
function useClassConstructor(module: TypeDoc.DeclarationReflection) {
  const constructor = useClass(module).children?.find(
    (c) => c.kind === TypeDoc.ReflectionKind.Constructor
  );
  if (!constructor) throw new Error("Constructor not found");
  return constructor;
}
function useClassMethods(module: TypeDoc.DeclarationReflection) {
  return useClass(module)
    .getChildrenByKind(TypeDoc.ReflectionKind.Method)
    .filter(
      (c) =>
        !c.flags.isExternal &&
        !c.flags.isPrivate &&
        c.signatures &&
        !c.signatures[0].comment?.modifierTags.has("@internal")
    );
}
function useClassMethodByName(
  module: TypeDoc.DeclarationReflection,
  methodName: string
) {
  return useClass(module)
    .getChildrenByKind(TypeDoc.ReflectionKind.Method)
    .find((c) => !c.flags.isExternal && c.signatures?.[0].name === methodName);
}
function useClassGetters(module: TypeDoc.DeclarationReflection) {
  return (useClass(module).children ?? []).filter(
    (c) => c.kind === TypeDoc.ReflectionKind.Accessor && c.flags.isPublic
  );
}
function useInterfaceProps(i: TypeDoc.DeclarationReflection) {
  if (!i.children?.length) throw new Error(`Interface ${i.name} has no props`);

  return i.children
    .filter((c) => !c.comment?.modifierTags.has("@internal"))
    .filter((c) => !c.comment?.blockTags.find((t) => t.tag === "@deprecated"));
}
function useNestedTypes(
  type: TypeDoc.SomeType,
  prefix: string = "",
  depth: number = 0
): {
  subType: TypeDoc.DeclarationReflection;
  prefix: string;
  depth: number;
}[] {
  if (type.type === "union") {
    return type.types.flatMap((t) => useNestedTypes(t, prefix, depth));
  }
  if (type.type === "array") {
    return useNestedTypes(type.elementType, `${prefix}[]`, depth);
  }
  if (type.type === "reference") {
    return (type.typeArguments ?? []).flatMap((t) =>
      type.package === "typescript" && type.name === "Record"
        ? useNestedTypes(t, `${prefix}[]`, depth)
        : useNestedTypes(t, prefix, depth)
    );
  }
  if (type.type === "reflection" && type.declaration.children?.length) {
    return type.declaration.children!.flatMap((subType) => [
      { prefix, subType, depth },
      ...(subType.kind === TypeDoc.ReflectionKind.Property
        ? useNestedTypes(subType.type!, `${prefix}.${subType.name}`, depth + 1)
        : []),
      ...(subType.kind === TypeDoc.ReflectionKind.Accessor
        ? useNestedTypes(
          subType.getSignature?.type!,
          `${prefix}.${subType.name}`,
          depth + 1
        )
        : []),
    ]);
  }

  return [];
}

/********************/
/** Other functions */
/********************/

function configureLogger() {
  if (process.env.DEBUG) return;
  console.debug = () => { };
}

function patchCode() {
  // patch Input
  fs.renameSync(
    "../platform/src/components/input.ts",
    "../platform/src/components/input.ts.bk"
  );
  fs.copyFileSync("./input-patch.ts", "../platform/src/components/input.ts");
  // patch global
  const globalType = fs.readFileSync("../platform/src/global.d.ts");
  fs.writeFileSync(
    "../platform/src/global-config.d.ts",
    globalType
      .toString()
      .trim()
      // move all exports out of `declare global {}`, b/c TypeDoc doesn't support it
      .replace("declare global {", "")
      .replace(/}$/, "")
      // change `export import $util` to `export const $util` b/c TypeDoc
      // tries to traverse the import and fails. We don't need to look into $util
      // anyways as we will link to the pulumi docs.
      .replace("export import $util", "export const $util")
      // change `export function $resolve` to `function $resolve` b/c TypeDoc
      // search multiple lines
      .replace(
        /export function \$resolve[\s\S]*?(?=\/\*\*)/,
        "export const $resolve: typeof util.all;\n"
      )
  );
  // patch Linkable
  fs.cpSync(
    "../platform/src/components/linkable.ts",
    "../platform/src/components/linkable.ts.bk"
  );
  fs.writeFileSync(
    "../platform/src/components/linkable.ts",
    fs
      .readFileSync("../platform/src/components/linkable.ts")
      .toString()
      .trim()
      // replace generic <Properties>
      .replace("properties: Properties", "properties: Record<string, any>")
      .replace(
        "public get properties() {",
        "public get properties(): Record<string, any> {"
      )
      // replace generic <Resource>
      .replaceAll(`cls: { new (...args: any[]): Resource }`, `cls: Constructor`)
      // replace Definition.include
      .replace(
        /include\?\: \{[^}]*\}/,
        `include?: (AwsPermission | CloudflareBinding)`
      ) +
    "\ntype Constructor = {};\n" +
    "\ntype AwsPermission = {};\n" +
    "\ntype CloudflareBinding = {};\n"
  );
}

function restoreCode() {
  // restore Input
  fs.renameSync(
    "../platform/src/components/input.ts.bk",
    "../platform/src/components/input.ts"
  );
  // restore global
  fs.rmSync("../platform/src/global-config.d.ts");
  // restore Linkable
  fs.renameSync(
    "../platform/src/components/linkable.ts.bk",
    "../platform/src/components/linkable.ts"
  );
}

async function buildComponents() {
  // Generate project reflection
  const app = await TypeDoc.Application.bootstrap({
    // Ignore type errors caused by patching `Input<>`.
    skipErrorChecking: true,
    // Disable parsing @default tags as ```ts block code.
    jsDocCompatibility: {
      defaultTag: false,
    },
    entryPoints: [
      "../platform/src/config.ts",
      "../platform/src/global-config.d.ts",
      "../platform/src/components/experimental/dev-command.ts",
      "../platform/src/components/linkable.ts",
      "../platform/src/components/secret.ts",
      "../platform/src/components/aws/analog.ts",
      "../platform/src/components/aws/apigateway-websocket.ts",
      "../platform/src/components/aws/apigateway-websocket-route.ts",
      "../platform/src/components/aws/apigatewayv1.ts",
      "../platform/src/components/aws/apigatewayv1-authorizer.ts",
      "../platform/src/components/aws/apigatewayv1-integration-route.ts",
      "../platform/src/components/aws/apigatewayv1-lambda-route.ts",
      "../platform/src/components/aws/apigatewayv2.ts",
      "../platform/src/components/aws/apigatewayv2-authorizer.ts",
      "../platform/src/components/aws/apigatewayv2-lambda-route.ts",
      "../platform/src/components/aws/apigatewayv2-private-route.ts",
      "../platform/src/components/aws/apigatewayv2-url-route.ts",
      "../platform/src/components/aws/app-sync.ts",
      "../platform/src/components/aws/app-sync-data-source.ts",
      "../platform/src/components/aws/app-sync-function.ts",
      "../platform/src/components/aws/app-sync-resolver.ts",
      "../platform/src/components/aws/bucket.ts",
      "../platform/src/components/aws/bucket-lambda-subscriber.ts",
      "../platform/src/components/aws/bucket-queue-subscriber.ts",
      "../platform/src/components/aws/bucket-topic-subscriber.ts",
      "../platform/src/components/aws/cluster.ts",
      "../platform/src/components/aws/cluster-v1.ts",
      "../platform/src/components/aws/cognito-identity-pool.ts",
      "../platform/src/components/aws/cognito-identity-provider.ts",
      "../platform/src/components/aws/cognito-user-pool.ts",
      "../platform/src/components/aws/cognito-user-pool-client.ts",
      "../platform/src/components/aws/cron.ts",
      "../platform/src/components/aws/dynamo.ts",
      "../platform/src/components/aws/dynamo-lambda-subscriber.ts",
      "../platform/src/components/aws/efs.ts",
      "../platform/src/components/aws/email.ts",
      "../platform/src/components/aws/function.ts",
      "../platform/src/components/aws/postgres.ts",
      "../platform/src/components/aws/postgres-v1.ts",
      "../platform/src/components/aws/vector.ts",
      "../platform/src/components/aws/astro.ts",
      "../platform/src/components/aws/nextjs.ts",
      "../platform/src/components/aws/nuxt.ts",
      "../platform/src/components/aws/realtime.ts",
      "../platform/src/components/aws/realtime-lambda-subscriber.ts",
      "../platform/src/components/aws/redis.ts",
      "../platform/src/components/aws/remix.ts",
      "../platform/src/components/aws/queue.ts",
      "../platform/src/components/aws/queue-lambda-subscriber.ts",
      "../platform/src/components/aws/kinesis-stream.ts",
      "../platform/src/components/aws/kinesis-stream-lambda-subscriber.ts",
      "../platform/src/components/aws/router.ts",
      "../platform/src/components/aws/service.ts",
      "../platform/src/components/aws/sns-topic.ts",
      "../platform/src/components/aws/sns-topic-lambda-subscriber.ts",
      "../platform/src/components/aws/sns-topic-queue-subscriber.ts",
      "../platform/src/components/aws/solid-start.ts",
      "../platform/src/components/aws/static-site.ts",
      "../platform/src/components/aws/svelte-kit.ts",
      "../platform/src/components/aws/vpc.ts",
      "../platform/src/components/aws/vpc-v1.ts",
      "../platform/src/components/cloudflare/worker.ts",
      "../platform/src/components/cloudflare/bucket.ts",
      "../platform/src/components/cloudflare/d1.ts",
      "../platform/src/components/cloudflare/kv.ts",
      // internal
      "../platform/src/components/aws/dns.ts",
      "../platform/src/components/cloudflare/dns.ts",
      "../platform/src/components/vercel/dns.ts",
      "../platform/src/components/aws/cdn.ts",
      "../platform/src/components/aws/iam-edit.ts",
      "../platform/src/components/aws/permission.ts",
      "../platform/src/components/cloudflare/binding.ts",
    ],
    tsconfig: "../platform/tsconfig.json",
  });

  const project = await app.convert();
  if (!project) throw new Error("Failed to convert project");

  // Generate JSON (generated for debugging purposes)
  await app.generateJson(project, "components-doc.json");

  return project.getChildrenByKind(TypeDoc.ReflectionKind.Module);
}

async function buildSdk() {
  // Generate project reflection
  const app = await TypeDoc.Application.bootstrap({
    // Ignore type errors caused by patching `Input<>`.
    skipErrorChecking: true,
    // Disable parsing @default tags as ```ts block code.
    jsDocCompatibility: {
      defaultTag: false,
    },
    entryPoints: [
      "../sdk/js/src/aws/realtime.ts",
      "../sdk/js/src/vector/index.ts",
    ],
    tsconfig: "../sdk/js/tsconfig.json",
  });

  const project = await app.convert();
  if (!project) throw new Error("Failed to convert project");

  // Generate JSON (generated for debugging purposes)
  await app.generateJson(project, "sdk-doc.json");

  return project.getChildrenByKind(TypeDoc.ReflectionKind.Module);
}

async function buildExamples() {
  // Generate project reflection
  const app = await TypeDoc.Application.bootstrap({
    // Ignore type errors caused by patching `Input<>`.
    skipErrorChecking: true,
    // Disable parsing @default tags as ```ts block code.
    jsDocCompatibility: {
      defaultTag: false,
    },
    entryPoints: ["../examples/*/sst.config.ts"],
    tsconfig: "../examples/tsconfig.json",
  });

  const project = await app.convert();
  if (!project) throw new Error("Failed to convert project");

  // Generate JSON (generated for debugging purposes)
  await app.generateJson(project, "examples-doc.json");

  return project.children!.filter(
    (c) =>
      c.kind === TypeDoc.ReflectionKind.Module &&
      c.children?.length === 1 &&
      c.children[0].comment
  );
}
