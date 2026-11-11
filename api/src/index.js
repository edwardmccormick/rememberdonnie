// Lambda entry point.
import { createApp } from './app.js';
import { createDynamoStore, createS3Media, createSecretReader, createSnsNotifier } from './aws.js';

const env = process.env;

export const handler = createApp({
  store: createDynamoStore(env.TABLE_NAME),
  media: createS3Media(env.MEDIA_BUCKET),
  notifier: createSnsNotifier(env.TOPIC_ARN),
  getSecret: createSecretReader(env.ADMIN_SECRET_ARN),
  config: { moderationMode: env.MODERATION_MODE, siteUrl: env.SITE_URL },
});
