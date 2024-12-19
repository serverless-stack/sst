import { Prettify } from "../auth/handler.js";

export module event {
  export type Definition = {
    type: string;
    $input: any;
    $output: any;
    $metadata: any;
    $payload: any;
    create: (...args: any[]) => Promise<any>;
  };

  export function builder<
    Metadata extends
      | ((type: string, properties: any) => any)
      | Parameters<Validator>[0],
    Validator extends (schema: any) => (input: any) => any,
  >(input: { validator: Validator; metadata?: Metadata }) {
    const validator = input.validator;
    const fn = function event<
      Type extends string,
      Schema extends Parameters<Validator>[0],
    >(type: Type, schema: Schema) {
      type MetadataOutput = Metadata extends (
        type: string,
        properties: any,
      ) => any
        ? ReturnType<Metadata>
        : // @ts-expect-error
          inferParser<Metadata>["out"];
      type Payload = Prettify<{
        type: Type;
        properties: Parsed["out"];
        metadata: MetadataOutput;
      }>;
      type Parsed = inferParser<Schema>;
      type Create = Metadata extends (type: string, properties: any) => any
        ? (properties: Parsed["in"]) => Promise<Payload>
        : (
            properties: Parsed["in"],
            // @ts-expect-error
            metadata: inferParser<Metadata>["in"],
          ) => Promise<Payload>;
      const validate = validator(schema);
      async function create(properties: any, metadata?: any) {
        metadata = input.metadata
          ? typeof input.metadata === "function"
            ? input.metadata(type, properties)
            : input.metadata(metadata)
          : metadata;
        properties = validate(properties);
        return {
          type,
          properties,
          metadata,
        };
      }
      return {
        create: create as Create,
        type,
        $input: {} as Parsed["in"],
        $output: {} as Parsed["out"],
        $payload: {} as Payload,
        $metadata: {} as MetadataOutput,
      } satisfies Definition;
    };
    fn.coerce = <Events extends Definition>(
      _events: Events | Events[],
      raw: any,
    ): {
      [K in Events["type"]]: Extract<Events, { type: K }>["$payload"];
    }[Events["type"]] => {
      return raw;
    };
    return fn;
  }

  // Taken from tRPC
  type ParserZodEsque<TInput, TParsedInput> = {
    _input: TInput;
    _output: TParsedInput;
  };

  type ParserValibotEsque<TInput, TParsedInput> = {
    _types?: {
      input: TInput;
      output: TParsedInput;
    };
  };

  type ParserMyZodEsque<TInput> = {
    parse: (input: any) => TInput;
  };

  type ParserSuperstructEsque<TInput> = {
    create: (input: unknown) => TInput;
  };

  type ParserCustomValidatorEsque<TInput> = (
    input: unknown,
  ) => Promise<TInput> | TInput;

  type ParserYupEsque<TInput> = {
    validateSync: (input: unknown) => TInput;
  };

  type ParserScaleEsque<TInput> = {
    assert(value: unknown): asserts value is TInput;
  };

  export type ParserWithoutInput<TInput> =
    | ParserCustomValidatorEsque<TInput>
    | ParserMyZodEsque<TInput>
    | ParserScaleEsque<TInput>
    | ParserSuperstructEsque<TInput>
    | ParserYupEsque<TInput>;

  export type ParserWithInputOutput<TInput, TParsedInput> =
    | ParserZodEsque<TInput, TParsedInput>
    | ParserValibotEsque<TInput, TParsedInput>;

  export type Parser =
    | ParserWithInputOutput<any, any>
    | ParserWithoutInput<any>;

  export type inferParser<TParser extends Parser> =
    TParser extends ParserWithInputOutput<infer $TIn, infer $TOut>
      ? {
          in: $TIn;
          out: $TOut;
        }
      : TParser extends ParserWithoutInput<infer $InOut>
        ? {
            in: $InOut;
            out: $InOut;
          }
        : never;
}
