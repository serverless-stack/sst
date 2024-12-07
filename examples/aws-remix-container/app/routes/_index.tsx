import { Resource } from "sst";
import { useLoaderData } from "@remix-run/react";
import type { MetaFunction } from "@remix-run/node";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export const meta: MetaFunction = () => {
  return [
    { title: "New Remix App" },
    { name: "description", content: "Welcome to Remix!" },
  ];
};

export async function loader() {
  const command = new PutObjectCommand({
    Key: crypto.randomUUID(),
    Bucket: Resource.MyBucket.name,
  });
  const url = await getSignedUrl(new S3Client({}), command);

  return { url };
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-8">
        <h1 className="leading text-2xl font-bold text-gray-800 dark:text-gray-100">
          Welcome to Remix
        </h1>
        <form
          className="flex flex-row gap-4"
          onSubmit={async (e) => {
            e.preventDefault();

            const file = (e.target as HTMLFormElement).file.files?.[0]!;

            const image = await fetch(data.url, {
              body: file,
              method: "PUT",
              headers: {
                "Content-Type": file.type,
                "Content-Disposition": `attachment; filename="${file.name}"`,
              },
            });

            window.location.href = image.url.split("?")[0];
          }}
        >
          <input
            name="file"
            type="file"
            accept="image/png, image/jpeg"
            className="block w-full text-sm text-slate-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-full file:border-0
              file:text-sm file:font-semibold
              file:bg-violet-50 file:text-violet-700
              hover:file:bg-violet-100" />
          <button className="bg-violet-500 hover:bg-violet-700 text-white text-sm
            font-semibold py-2 px-4 rounded-full">
            Upload
          </button>
        </form>
      </div>
    </div>
  );
}
