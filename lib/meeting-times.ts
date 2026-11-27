/**
 * Meeting slot maths for the Meetings screen.
 *
 * Pure by contract: every function that needs the current time takes an
 * injected `now`, so nothing in here reads the clock and the tests are
 * deterministic in any timezone. Values are the `yyyy-MM-dd'T'HH:mm` local
 * strings that `<input type="datetime-local">` already uses — the inputs stay
 * the source of truth, these functions only move them around.
 */

import {
  addDays,
  addHours,
  addMinutes,
  differenceInCalendarDays,
  format,
  isSameHour,
  parseISO,
  startOfDay,
  startOfHour,
} from 'date-fns';

/** `yyyy-MM-dd'T'HH:mm` — the datetime-local input value format. */
export const LOCAL_INPUT_FORMAT = "yyyy-MM-dd'T'HH:mm";

/** How long a meeting is when nothing says otherwise. */
export const DEFAULT_DURATION_MINUTES = 60;

/** Starts snap to this grid (:00 / :30). */
export const SLOT_MINUTES = 30;

export const DURATION_PRESETS: ReadonlyArray<{ label: string; minutes: number }> = [
  { label: '30m', minutes: 30 },
  { label: '45m', minutes: 45 },
  { label: '1h', minutes: 60 },
  { label: '90m', minutes: 90 },
  { label: '2h', minutes: 120 },
];

/** Day chips, expressed as an offset in calendar days from `now`. */
export const DAY_CHIPS: ReadonlyArray<{ label: string; days: number }> = [
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'Next week', days: 7 },
];

export function formatLocalInput(date: Date): string {
  return format(date, LOCAL_INPUT_FORMAT);
}

/** Local parse of a datetime-local value; null when empty or unparseable. */
export function parseLocalInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The next slot worth proposing: rounded up to a :00/:30 boundary, and if that
 * boundary still sits inside the hour we are already in, the top of the next
 * hour instead — so a "new meeting" never opens pre-filled with a start that
 * is two minutes away.
 */
export function nextCleanSlot(now: Date): Date {
  const rounded = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    Math.ceil(now.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES,
    0,
    0
  );
  const slot = rounded.getTime() > now.getTime() ? rounded : addMinutes(rounded, SLOT_MINUTES);
  return isSameHour(slot, now) ? startOfHour(addHours(now, 1)) : slot;
}

export function slotFromStart(start: Date, durationMinutes: number = DEFAULT_DURATION_MINUTES): SlotPair {
  return {
    starts_at: formatLocalInput(start),
    ends_at: formatLocalInput(addMinutes(start, durationMinutes)),
  };
}

/** What the New-meeting form opens with. */
export function defaultSlot(now: Date, durationMinutes: number = DEFAULT_DURATION_MINUTES): SlotPair {
  return slotFromStart(nextCleanSlot(now), durationMinutes);
}

/** `ends_at` for a start + a duration; '' when the start is not usable. */
export function endsFor(startsValue: string, minutes: number): string {
  const start = parseLocalInput(startsValue);
  return start ? formatLocalInput(addMinutes(start, minutes)) : '';
}

/** Whole minutes between start and end, or null if absent / not positive. */
export function durationMinutes(startsValue: string, endsValue: string): number | null {
  const start = parseLocalInput(startsValue);
  const end = parseLocalInput(endsValue);
  if (!start || !end) return null;
  const mins = Math.round((end.getTime() - start.getTime()) / 60000);
  return mins > 0 ? mins : null;
}

/** True when an end is not usable against its start (before it, or the same minute). */
export function isEndBeforeStart(startsValue: string, endsValue: string): boolean {
  const start = parseLocalInput(startsValue);
  const end = parseLocalInput(endsValue);
  if (!start || !end) return false;
  return end.getTime() <= start.getTime();
}

/** Calendar days between the start and `now`: 0 today, 1 tomorrow, -3 three days ago. */
export function dayOffsetFromToday(startsValue: string, now: Date): number | null {
  const start = parseLocalInput(startsValue);
  if (!start) return null;
  return differenceInCalendarDays(start, startOfDay(now));
}

/**
 * Heading a list of meetings is grouped by, relative to `now`: named days up
 * close, weekdays for this week, then plain dates, and whole months for history
 * so a long Past tab reads as a few bands instead of one row per day.
 */
export function dayHeading(start: Date, now: Date): string {
  const offset = differenceInCalendarDays(start, startOfDay(now));
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  if (offset < -1) return format(start, 'MMM yyyy');
  if (offset <= 6) return format(start, 'EEEE');
  if (start.getFullYear() === now.getFullYear()) return format(start, 'd MMM');
  return format(start, 'd MMM yyyy');
}

/** One mono line describing the chosen slot, e.g. `2026-11-27 15:00 → 16:00 · 60 min`. */
export function slotSummary(startsValue: string, endsValue: string): string {
  const start = parseLocalInput(startsValue);
  if (!start) return 'Pick a start time';
  const head = format(start, 'yyyy-MM-dd HH:mm');
  const end = parseLocalInput(endsValue);
  if (!end) return `${head} → open end`;
  if (isEndBeforeStart(startsValue, endsValue)) {
    return `${head} → ${format(end, 'HH:mm')} · ends before it starts`;
  }
  const sameDay = format(end, 'yyyy-MM-dd') === format(start, 'yyyy-MM-dd');
  const mins = Math.round((end.getTime() - start.getTime()) / 60000);
  return `${head} → ${format(end, sameDay ? 'HH:mm' : 'yyyy-MM-dd HH:mm')} · ${mins} min`;
}

/** The two inputs plus whether `ends_at` still follows `starts_at`. */
export interface SlotState {
  starts_at: string;
  ends_at: string;
  follow: boolean;
}

type SlotPair = Pick<SlotState, 'starts_at' | 'ends_at'>;

/** Moving the start drags the end with it, keeping the current duration — while following. */
export function editStart(state: SlotState, startsValue: string): SlotState {
  if (!state.follow || !state.ends_at) return { ...state, starts_at: startsValue };
  const mins = durationMinutes(state.starts_at, state.ends_at) ?? DEFAULT_DURATION_MINUTES;
  return { starts_at: startsValue, ends_at: endsFor(startsValue, mins), follow: true };
}

/** A hand-typed end wins: stop deriving it until a duration pick or day chip says otherwise. */
export function editEnd(state: SlotState, endsValue: string): SlotState {
  return { ...state, ends_at: endsValue, follow: false };
}

/** Duration quick-pick: sets the end from the start and starts following again. */
export function pickDuration(state: SlotState, minutes: number): SlotState {
  const ends_at = endsFor(state.starts_at, minutes);
  if (!ends_at) return state; // no usable start to hang a duration on
  return { ...state, ends_at, follow: true };
}

/**
 * Day chip: move both fields the same number of calendar days so the clock
 * times survive, including across a month end. `days` is an offset from `now`.
 */
export function shiftDay(state: SlotState, days: number, now: Date): SlotState {
  const start = parseLocalInput(state.starts_at);
  const offset = dayOffsetFromToday(state.starts_at, now);
  if (!start || offset === null) return state;
  const delta = days - offset;
  if (delta === 0) return state;
  const next: SlotState = { ...state, starts_at: formatLocalInput(addDays(start, delta)) };
  const end = parseLocalInput(state.ends_at);
  if (end) next.ends_at = formatLocalInput(addDays(end, delta));
  return next;
}
