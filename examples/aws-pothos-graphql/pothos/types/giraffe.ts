import { builder } from "../builder";

export class Giraffe {
  name: string;

  constructor(name: string) {
    this.name = name;
  }
}

builder.objectType(Giraffe, {
  name: "Giraffe",
  description: "Long necks, cool patterns, taller than you.",
  fields: (t) => ({
    name: t.exposeString("name", {}),
  }),
});

builder.queryFields((t) => ({
  giraffe: t.field({
    type: Giraffe,
    resolve: () => new Giraffe("James"),
  }),
}));

builder.mutationFields((t) => ({
  createGiraffe: t.field({
    type: Giraffe,
    args: {
      name: t.arg.string({ required: true }),
    },
    resolve: async (root, args) => {
      const giraffe = { name: args.name };

      return giraffe;
    },
  }),
}));
