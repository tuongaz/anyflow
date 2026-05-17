import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { unzipSync } from 'fflate';

const s3 = new S3Client({});
const BUCKET = process.env.DIAGRAMS_BUCKET_NAME ?? '';

const MAX_TOTAL = 50 * 1024 * 1024;
const MAX_FILE = 10 * 1024 * 1024;

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function handlePostFlows(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const email = event.queryStringParameters?.email;
  if (!email) {
    return json(400, { error: 'Missing email' });
  }

  const bodyStr = event.body ?? '';
  const zipBytes = event.isBase64Encoded
    ? Buffer.from(bodyStr, 'base64')
    : Buffer.from(bodyStr, 'binary');

  if (zipBytes.length > MAX_TOTAL) {
    return json(413, { error: 'Upload too large' });
  }

  let unzipped: ReturnType<typeof unzipSync>;
  try {
    unzipped = unzipSync(new Uint8Array(zipBytes));
  } catch {
    return json(400, { error: 'Invalid zip file' });
  }

  for (const data of Object.values(unzipped)) {
    if (data.length > MAX_FILE) {
      return json(413, { error: 'File too large' });
    }
  }

  const uuid = randomUUID();

  for (const [filePath, data] of Object.entries(unzipped)) {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${uuid}/${filePath}`,
        Body: data,
      }),
    );
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${uuid}/metadata.json`,
      Body: JSON.stringify({ email, createdAt: new Date().toISOString() }),
      ContentType: 'application/json',
    }),
  );

  return json(201, { url: `https://seeflow.dev/flow/${uuid}` });
}

async function handleGetFlow(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const uuid = event.pathParameters?.uuid;
  if (!uuid) return json(400, { error: 'Missing uuid' });

  try {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `${uuid}/seeflow.json` }),
    );
    const body = await result.Body?.transformToString('utf-8');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: body ?? '',
    };
  } catch {
    return json(404, { error: 'Not found' });
  }
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  json: 'application/json',
  txt: 'text/plain',
};

async function handleGetFlowFile(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const uuid = event.pathParameters?.uuid;
  const proxy = event.pathParameters?.proxy;
  if (!uuid || !proxy) return json(400, { error: 'Missing parameters' });

  const ext = proxy.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

  try {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `${uuid}/files/${proxy}` }),
    );
    const bytes = await result.Body?.transformToByteArray();
    return {
      statusCode: 200,
      headers: { 'Content-Type': contentType },
      body: bytes ? Buffer.from(bytes).toString('base64') : '',
      isBase64Encoded: true,
    };
  } catch {
    return json(404, { error: 'Not found' });
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const routeKey = event.routeKey;

  if (routeKey === 'POST /flows') return handlePostFlows(event);
  if (routeKey === 'GET /flows/{uuid}') return handleGetFlow(event);
  if (routeKey === 'GET /flows/{uuid}/files/{proxy+}') return handleGetFlowFile(event);

  return json(404, { error: 'Not found' });
};
