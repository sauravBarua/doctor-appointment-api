import { DateTime } from 'luxon';
import { SLOT_DURATION_MINUTES } from '../../config/constants.js';

export interface WindowRule {
  weekday: number;
  startMinute: number;
  endMinute: number;
}
export interface Block {
  startTime: Date;
  endTime: Date;
}
export interface Slot {
  startTime: Date;
  endTime: Date;
}
export interface DaySlots {
  date: string;
  slots: Slot[];
}

interface BuildInput {
  from: string; // YYYY-MM-DD, clinic-local
  to: string; // YYYY-MM-DD, clinic-local, inclusive
  timezone: string;
  rules: WindowRule[];
  blocks: Block[]; // time-off and booked appointments
  now: Date;
}

export function buildDaySlots({ from, to, timezone, rules, blocks, now }: BuildInput): DaySlots[] {
  const sortedRules = [...rules].sort(
    (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute,
  );
  const nowMs = now.getTime();
  const stepMs = SLOT_DURATION_MINUTES * 60_000;
  const last = DateTime.fromISO(to, { zone: timezone }).startOf('day');
  const result: DaySlots[] = [];

  for (
    let day = DateTime.fromISO(from, { zone: timezone }).startOf('day');
    day <= last;
    day = day.plus({ days: 1 }).startOf('day')
  ) {
    const slots: Slot[] = [];
    for (const rule of sortedRules) {
      if (rule.weekday !== day.weekday) continue;
      for (
        let m = rule.startMinute;
        m + SLOT_DURATION_MINUTES <= rule.endMinute;
        m += SLOT_DURATION_MINUTES
      ) {
        const start = day.set({ hour: Math.floor(m / 60), minute: m % 60 });
        // Wall-clock time that does not exist (daylight-saving gap): skip it.
        if (start.hour * 60 + start.minute !== m) continue;
        const startMs = start.toMillis();
        const endMs = startMs + stepMs;
        if (startMs <= nowMs) continue;
        if (blocks.some((b) => b.startTime.getTime() < endMs && b.endTime.getTime() > startMs))
          continue;
        slots.push({ startTime: new Date(startMs), endTime: new Date(endMs) });
      }
    }
    result.push({ date: day.toISODate()!, slots });
  }
  return result;
}
