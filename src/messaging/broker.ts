import amqp, { type ConfirmChannel } from 'amqplib';
import { HANDLER_MAX_ATTEMPTS } from '../config/constants.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export const EXCHANGE = 'appointments';
export const BINDING_KEY = 'appointment.*';
export const QUEUE = 'notifications.appointments';
export const DLX = 'appointments.dlx';
export const DLQ = 'notifications.appointments.dlq';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
export type MessageHandler = (payload: unknown) => Promise<void>;

let connection: Connection | null = null;
let channel: ConfirmChannel | null = null;
let consumerTag: string | null = null;
let handler: MessageHandler | null = null;
let stopping = false;
let attempt = 0;
let retryTimer: NodeJS.Timeout | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(fn: () => Promise<void>): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= HANDLER_MAX_ATTEMPTS) throw err;
      logger.warn({ err, attempt: i }, 'Message handler failed, retrying');
      await sleep(500 * 2 ** (i - 1));
    }
  }
}

async function setup(): Promise<void> {
  const conn = await amqp.connect(env.RABBITMQ_URL);
  conn.on('error', (err: unknown) => logger.warn({ err }, 'RabbitMQ connection error'));
  conn.on('close', () => {
    connection = null;
    channel = null;
    consumerTag = null;
    if (!stopping) scheduleReconnect();
  });

  const ch = await conn.createConfirmChannel();
  ch.on('error', (err: unknown) => logger.warn({ err }, 'RabbitMQ channel error'));

  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(DLX, 'fanout', { durable: true });
  await ch.assertQueue(DLQ, { durable: true });
  await ch.bindQueue(DLQ, DLX, '');
  await ch.assertQueue(QUEUE, { durable: true, deadLetterExchange: DLX });
  await ch.bindQueue(QUEUE, EXCHANGE, BINDING_KEY);

  connection = conn;
  channel = ch;
  attempt = 0;
  logger.info('RabbitMQ connected');

  if (handler) {
    const onMessage = handler;
    await ch.prefetch(10);
    const { consumerTag: tag } = await ch.consume(QUEUE, async (msg) => {
      if (!msg) return;
      try {
        const payload: unknown = JSON.parse(msg.content.toString());
        await withRetry(() => onMessage(payload));
        ch.ack(msg);
      } catch (err) {
        logger.error({ err }, 'Message failed, sending to the dead-letter queue');
        ch.nack(msg, false, false);
      }
    });
    consumerTag = tag;
  }
}

function scheduleReconnect(): void {
  if (stopping || retryTimer) return;
  const delay = Math.min(30_000, 1000 * 2 ** attempt++);
  logger.warn({ delayMs: delay }, 'RabbitMQ unavailable, will retry');
  retryTimer = setTimeout(() => {
    retryTimer = null;
    setup().catch((err: unknown) => {
      logger.warn({ err }, 'RabbitMQ reconnect failed');
      scheduleReconnect();
    });
  }, delay);
  retryTimer.unref();
}

/** Never throws: the API keeps running when the broker is down and reconnects in the background. */
export async function startMessaging(options: { consumer?: MessageHandler } = {}): Promise<void> {
  stopping = false;
  handler = options.consumer ?? null;
  try {
    await setup();
  } catch (err) {
    logger.warn({ err }, 'RabbitMQ not reachable at startup');
    scheduleReconnect();
  }
}

export function isMessagingUp(): boolean {
  return channel !== null;
}

/** Resolves true once the broker confirmed the message. Never throws. */
export async function publish(routingKey: string, payload: object): Promise<boolean> {
  const ch = channel;
  if (!ch) {
    if (env.NODE_ENV !== 'test') logger.warn({ routingKey }, 'RabbitMQ unavailable, event dropped');
    return false;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      ch.publish(
        EXCHANGE,
        routingKey,
        Buffer.from(JSON.stringify(payload)),
        { persistent: true, contentType: 'application/json' },
        (err) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve()),
      );
    });
    return true;
  } catch (err) {
    logger.error({ err, routingKey }, 'Publishing to RabbitMQ failed');
    return false;
  }
}

export async function stopMessaging(): Promise<void> {
  stopping = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  try {
    if (channel && consumerTag) await channel.cancel(consumerTag);
    await channel?.close();
    await connection?.close();
  } catch (err) {
    logger.warn({ err }, 'RabbitMQ shutdown was not clean');
  } finally {
    connection = null;
    channel = null;
    consumerTag = null;
  }
}
