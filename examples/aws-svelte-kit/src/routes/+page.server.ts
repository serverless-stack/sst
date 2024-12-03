import { Resource } from "sst";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

/** @type {import('./$types').PageServerLoad} */
export async function load() {
	const command = new PutObjectCommand({
		Key: crypto.randomUUID(),
		Bucket: Resource.MyBucket.name,
	});
	const url = await getSignedUrl(new S3Client({}), command);

	return { url };
}
