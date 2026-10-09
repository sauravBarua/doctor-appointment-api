import { describe, expect, it } from 'vitest';
import { buildDaySlots, type DaySlots } from '../src/modules/slots/slots.builder.js';

const timezone = 'Europe/Paris';
const past = new Date('2020-01-01T00:00:00Z');
const mondayRule = [{ weekday: 1, startMinute: 540, endMinute: 660 }]; // Mon 09:00-11:00 local
const iso = (d: Date) => d.toISOString();
const starts = (slots: { startTime: Date }[]) => slots.map((s) => iso(s.startTime));

// 2026-10-12 is a Monday, Paris is on summer time (UTC+2)
const monday = {
  from: '2026-10-12',
  to: '2026-10-12',
  timezone,
  rules: mondayRule,
  blocks: [],
  now: past,
};

function one(input: Parameters<typeof buildDaySlots>[0]): DaySlots {
  const [day] = buildDaySlots(input);
  if (!day) throw new Error('expected at least one day');
  return day;
}

describe('buildDaySlots', () => {
  it('cuts a window into 30-minute slots in the clinic timezone', () => {
    const day = one(monday);
    expect(starts(day.slots)).toEqual([
      '2026-10-12T07:00:00.000Z',
      '2026-10-12T07:30:00.000Z',
      '2026-10-12T08:00:00.000Z',
      '2026-10-12T08:30:00.000Z',
    ]);
  });

  it('returns an empty day when no rule matches the weekday', () => {
    const days = buildDaySlots({ ...monday, to: '2026-10-13' });
    expect(days.map((d) => d.slots.length)).toEqual([4, 0]);
  });

  it('drops slots that already started', () => {
    const day = one({ ...monday, now: new Date('2026-10-12T07:10:00Z') });
    expect(starts(day.slots)[0]).toBe('2026-10-12T07:30:00.000Z');
    expect(day.slots).toHaveLength(3);
  });

  it('removes slots that overlap a block', () => {
    const blocks = [
      { startTime: new Date('2026-10-12T07:15:00Z'), endTime: new Date('2026-10-12T07:45:00Z') },
    ];
    const day = one({ ...monday, blocks });
    expect(starts(day.slots)).toEqual(['2026-10-12T08:00:00.000Z', '2026-10-12T08:30:00.000Z']);
  });

  it('keeps slots that only touch a block', () => {
    const blocks = [
      { startTime: new Date('2026-10-12T07:30:00Z'), endTime: new Date('2026-10-12T08:00:00Z') },
    ];
    const day = one({ ...monday, blocks });
    expect(starts(day.slots)).toEqual([
      '2026-10-12T07:00:00.000Z',
      '2026-10-12T08:00:00.000Z',
      '2026-10-12T08:30:00.000Z',
    ]);
  });

  it('skips the daylight-saving gap on spring-forward day', () => {
    // Sunday 2027-03-28: clocks jump 02:00 -> 03:00 in Paris
    const rules = [{ weekday: 7, startMinute: 0, endMinute: 360 }];
    const day = one({
      from: '2027-03-28',
      to: '2027-03-28',
      timezone,
      rules,
      blocks: [],
      now: past,
    });
    const list = starts(day.slots);
    expect(list).toHaveLength(10);
    expect(list[0]).toBe('2027-03-27T23:00:00.000Z');
    const i = list.indexOf('2027-03-28T00:30:00.000Z');
    expect(list[i + 1]).toBe('2027-03-28T01:00:00.000Z');
  });
});
