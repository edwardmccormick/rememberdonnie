// AWS adapters: DynamoDB store, S3 media, SNS notifier, Secrets Manager key.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const MEMORY_PK = 'MEMORY';
const COUNTER_PK = 'COUNTER';

export function createDynamoStore(tableName, client = new DynamoDBClient({})) {
  const db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });

  const toMemory = ({ pk, sk, ...rest }) => ({ ...rest, id: sk });

  return {
    async listMemories() {
      const items = [];
      let ExclusiveStartKey;
      do {
        const page = await db.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: { ':pk': MEMORY_PK },
            ScanIndexForward: false,
            ExclusiveStartKey,
          }),
        );
        items.push(...(page.Items || []));
        ExclusiveStartKey = page.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items.map(toMemory);
    },
    async getMemory(id) {
      const { Item } = await db.send(new GetCommand({ TableName: tableName, Key: { pk: MEMORY_PK, sk: id } }));
      return Item ? toMemory(Item) : null;
    },
    async saveMemory({ id, ...memory }) {
      await db.send(new PutCommand({ TableName: tableName, Item: { pk: MEMORY_PK, sk: id, ...memory } }));
    },
    async deleteMemory(id) {
      await db.send(new DeleteCommand({ TableName: tableName, Key: { pk: MEMORY_PK, sk: id } }));
    },
    async getCandleCount() {
      const { Item } = await db.send(new GetCommand({ TableName: tableName, Key: { pk: COUNTER_PK, sk: 'candles' } }));
      return Item?.count || 0;
    },
    async incrementCandles() {
      const { Attributes } = await db.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: COUNTER_PK, sk: 'candles' },
          UpdateExpression: 'ADD #c :one',
          ExpressionAttributeNames: { '#c': 'count' },
          ExpressionAttributeValues: { ':one': 1 },
          ReturnValues: 'UPDATED_NEW',
        }),
      );
      return Attributes.count;
    },
    async hitRateLimit(key, limit, expiresAt) {
      try {
        await db.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: 'RATE', sk: key },
            UpdateExpression: 'ADD #c :one SET expiresAt = :exp',
            ConditionExpression: 'attribute_not_exists(#c) OR #c < :limit',
            ExpressionAttributeNames: { '#c': 'count' },
            ExpressionAttributeValues: { ':one': 1, ':exp': expiresAt, ':limit': limit },
          }),
        );
        return true;
      } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
    },
  };
}

export function createS3Media(bucket, client = new S3Client({})) {
  const pendingKey = (id) => `pending/${id}.jpg`;
  const publicKey = (id) => `photos/${id}.jpg`;

  return {
    async createUploadTicket(photoId, maxBytes) {
      const { url, fields } = await createPresignedPost(client, {
        Bucket: bucket,
        Key: pendingKey(photoId),
        Conditions: [
          ['content-length-range', 1, maxBytes],
          ['eq', '$Content-Type', 'image/jpeg'],
        ],
        Fields: { 'Content-Type': 'image/jpeg' },
        Expires: 900,
      });
      return { url, fields };
    },
    async pendingPhotoInfo(photoId) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: pendingKey(photoId) }));
        return { size: head.ContentLength, contentType: head.ContentType };
      } catch (err) {
        if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
    async publishPhoto(photoId) {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${pendingKey(photoId)}`,
          Key: publicKey(photoId),
          MetadataDirective: 'REPLACE',
          ContentType: 'image/jpeg',
          CacheControl: 'public, max-age=3600',
        }),
      );
      return `/${publicKey(photoId)}`;
    },
    async unpublishPhoto(photoId) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: publicKey(photoId) }));
    },
    async deletePhoto(photoId) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: publicKey(photoId) }));
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: pendingKey(photoId) }));
    },
    async previewUrl(photoId) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: pendingKey(photoId) }), { expiresIn: 3600 });
    },
  };
}

export function createSnsNotifier(topicArn, client = new SNSClient({})) {
  return {
    async notify(subject, message) {
      if (!topicArn) return;
      await client.send(new PublishCommand({ TopicArn: topicArn, Subject: subject, Message: message }));
    },
  };
}

export function createSecretReader(secretArn, client = new SecretsManagerClient({})) {
  let cached;
  return () => {
    cached ??= client
      .send(new GetSecretValueCommand({ SecretId: secretArn }))
      .then((r) => r.SecretString)
      .catch((err) => {
        cached = undefined;
        throw err;
      });
    return cached;
  };
}
