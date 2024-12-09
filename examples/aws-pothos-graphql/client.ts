import { Resource } from "sst";
import { createClient } from "./graphql/genql";

const client = createClient({
  url: `${Resource.PothosGraphql.url}/graphql`,
});

export async function handler() {
  const createGiraffe = await client.mutation({
    createGiraffe: {
      __args: {
        name: "Jonny",
      },
      name: true,
    },
  });

  return {
    statusCode: 200,
    body: createGiraffe,
  };
}
