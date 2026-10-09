import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';
import { afterAll, describe, expect, it } from 'vitest';
import {
  isMessagingUp,
  startMessaging,
  stopMessaging,
  BINDING_KEY,
  EXCHANGE,
} from '../src/messaging/broker.js';
import { publishAppointmentEvent } from '../src/messaging/events.js';

const url = process.env.RABBITMQ_URL ?? '';

async function brokerReachable(): Promise<boolean> {
  try {
    const conn = await amqp.connect(url);
    await conn.close();
    return true;
  } catch {
    return false;
  }
}

const up = url !== '' && (await brokerReachable());

afterAll(async () => {
  await stopMessaging();
});

describe.skipIf(!up)('RabbitMQ', () => {
  it('publishes appointment events through the exchange to bound queues', async () => {
    await startMessaging();
    for (let i = 0; i < 50 && !isMessagingUp(); i++) await new Promise((r) => setTimeout(r, 100));
    expect(isMessagingUp()).toBe(true);

    // a private queue sees a copy, whatever the running app is doing
    const conn = await amqp.connect(url);
    const ch = await conn.createChannel();
    const { queue } = await ch.assertQueue('', { exclusive: true });
    await ch.bindQueue(queue, EXCHANGE, BINDING_KEY);

    const appointmentId = randomUUID();
    const delivered = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no message received')), 5000);
      void ch.consume(queue, (msg) => {
        if (!msg) return;
        const body = JSON.parse(msg.content.toString()) as Record<string, unknown>;
        if (body['appointmentId'] !== appointmentId) return;
        clearTimeout(timer);
        resolve(body);
      });
    });

    const confirmed = await publishAppointmentEvent({
      type: 'appointment.booked',
      appointmentId,
      actor: { id: randomUUID(), role: 'PATIENT' },
    });
    expect(confirmed).toBe(true);
    expect(await delivered).toMatchObject({ type: 'appointment.booked', appointmentId });

    await conn.close();
  }, 15_000);
});
