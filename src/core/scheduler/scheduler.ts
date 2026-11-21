import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AuditLogStore } from '../audit-log.js';
import { NotFoundError, ValidationError, toErrorMessage } from '../../utils/errors.js';
import { readJsonFile, writeJsonFile } from '../../utils/fs.js';
import { formatZodError } from '../config/schema.js';

export const SCHEDULE_ACTIONS = [
  'start_streamer',
  'start_playlist',
  'start_queue',
  'start_screen',
  'stop',
] as const;

export type ScheduleAction = (typeof SCHEDULE_ACTIONS)[number];

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const ScheduleRuleCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit muss HH:MM sein'),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .default('Europe/Berlin')
    .refine(isValidTimeZone, 'Ungültige Zeitzone'),
  action: z.enum(SCHEDULE_ACTIONS),
  target_id: z.string().trim().max(120).nullable().optional(),
});

export const ScheduleRuleUpdateSchema = ScheduleRuleCreateSchema.partial();

export interface ScheduleRule {
  id: string;
  name: string;
  enabled: boolean;
  days: number[];
  time: string;
  timezone: string;
  action: ScheduleAction;
  target_id: string | null;
  last_run_at: string | null;
  last_run_key: string | null;
  last_error: string | null;
}

export interface ScheduleRuleView extends ScheduleRule {
  next_run_at: string | null;
}

export interface ScheduleExecutor {
  execute(rule: ScheduleRule): Promise<void>;
}

export interface StreamSchedulerOptions {
  path: string;
  executor: ScheduleExecutor;
  logger: Logger;
  audit?: AuditLogStore;
  tickIntervalMs?: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timezone, fmt);
  }
  return fmt;
}

export function localTimeParts(
  date: Date,
  timezone: string,
): { day: number; hhmm: string; minuteKey: string } {
  const parts = getFormatter(timezone).formatToParts(date);
  let weekday = 'Sun';
  let year = '1970';
  let month = '01';
  let dayOfMonth = '01';
  let hour = '00';
  let minute = '00';
  for (const part of parts) {
    switch (part.type) {
      case 'weekday':
        weekday = part.value;
        break;
      case 'year':
        year = part.value;
        break;
      case 'month':
        month = part.value;
        break;
      case 'day':
        dayOfMonth = part.value;
        break;
      case 'hour':
        hour = part.value === '24' ? '00' : part.value;
        break;
      case 'minute':
        minute = part.value;
        break;
      default:
        break;
    }
  }
  const day = WEEKDAY_MAP[weekday] ?? 0;
  const hhmm = `${hour}:${minute}`;
  return { day, hhmm, minuteKey: `${year}-${month}-${dayOfMonth}T${hhmm}` };
}

/** Computes the next matching trigger timestamp (UTC ISO) within 8 days. */
export function computeNextRunAt(
  rule: Pick<ScheduleRule, 'enabled' | 'days' | 'time' | 'timezone'>,
  from = new Date(),
): string | null {
  if (!rule.enabled || rule.days.length === 0 || !isValidTimeZone(rule.timezone)) return null;
  const [targetHour, targetMin] = rule.time.split(':').map(Number) as [number, number];
  const baseMs = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  // Step minute-by-minute across at most 8 days? Checking 11,520 minutes with
  // Intl is slow when called repeatedly. Instead jump by 1h / 1m: first step in
  // 1-hour increments up to 8 days (192 steps) and refine the matching hour or
  // DST edge in 1-minute increments (60 steps), plus check current partial hour.
  const maxMinutes = 8 * 24 * 60;
  for (let offsetMin = 0; offsetMin <= maxMinutes; ) {
    const candidate = new Date(baseMs + offsetMin * 60_000);
    const { day, hhmm } = localTimeParts(candidate, rule.timezone);
    if (!rule.days.includes(day)) {
      offsetMin += 60;
      continue;
    }
    const [curH, curM] = hhmm.split(':').map(Number) as [number, number];
    const diffMin = (targetHour - curH) * 60 + (targetMin - curM);
    if (diffMin === 0) return candidate.toISOString();
    if (diffMin > 0 && diffMin <= 60) {
      offsetMin += diffMin;
      continue;
    }
    offsetMin += Math.max(1, Math.min(60, diffMin > 0 ? diffMin : 60));
  }
  return null;
}

function normalizeDays(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

function normalizeTarget(action: ScheduleAction, rawTarget: string | null | undefined): string | null {
  const target = rawTarget?.trim() || null;
  if (action === 'start_streamer' || action === 'start_playlist') {
    if (!target) {
      throw new ValidationError('Für diese Aktion ist ein Ziel (Streamer oder Playlist) erforderlich');
    }
    return target;
  }
  if (action === 'start_screen') {
    if (target !== 'pause' && target !== 'startup') {
      throw new ValidationError('Screen-Ziel muss "pause" oder "startup" sein');
    }
    return target;
  }
  return null;
}

const MAX_RULES = 100;

/** Persistent time-based stream scheduler (#45). */
export class StreamScheduler {
  private readonly options: StreamSchedulerOptions;
  private rules: ScheduleRule[];
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(options: StreamSchedulerOptions) {
    this.options = options;
    this.rules = this.load();
  }

  private load(): ScheduleRule[] {
    const raw = readJsonFile<{ rules?: unknown[] }>(this.options.path, {});
    if (!Array.isArray(raw.rules)) return [];
    const rules: ScheduleRule[] = [];
    for (const item of raw.rules) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const parsed = ScheduleRuleCreateSchema.safeParse(obj);
      if (!parsed.success || typeof obj.id !== 'string' || !obj.id) continue;
      try {
        rules.push({
          id: obj.id,
          name: parsed.data.name,
          enabled: parsed.data.enabled,
          days: normalizeDays(parsed.data.days),
          time: parsed.data.time,
          timezone: parsed.data.timezone,
          action: parsed.data.action,
          target_id: normalizeTarget(parsed.data.action, parsed.data.target_id),
          last_run_at: typeof obj.last_run_at === 'string' ? obj.last_run_at : null,
          last_run_key: typeof obj.last_run_key === 'string' ? obj.last_run_key : null,
          last_error: typeof obj.last_error === 'string' ? obj.last_error : null,
        });
      } catch {
        /* skip malformed rule */
      }
    }
    return rules;
  }

  private save(): void {
    writeJsonFile(this.options.path, { rules: this.rules });
  }

  private toView(rule: ScheduleRule, now = new Date()): ScheduleRuleView {
    return {
      ...structuredClone(rule),
      next_run_at: computeNextRunAt(rule, now),
    };
  }

  list(now = new Date()): ScheduleRuleView[] {
    return this.rules.map((rule) => this.toView(rule, now));
  }

  get(id: string, now = new Date()): ScheduleRuleView | undefined {
    const rule = this.rules.find((entry) => entry.id === id);
    return rule ? this.toView(rule, now) : undefined;
  }

  create(rawInput: unknown): ScheduleRuleView {
    if (this.rules.length >= MAX_RULES) {
      throw new ValidationError(`Maximal ${MAX_RULES} Zeitpläne erlaubt`);
    }
    const parsed = ScheduleRuleCreateSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        `Ungültiger Zeitplan: ${formatZodError(parsed.error)}`,
        parsed.error.issues,
      );
    }
    const rule: ScheduleRule = {
      id: randomUUID().slice(0, 12),
      name: parsed.data.name,
      enabled: parsed.data.enabled,
      days: normalizeDays(parsed.data.days),
      time: parsed.data.time,
      timezone: parsed.data.timezone,
      action: parsed.data.action,
      target_id: normalizeTarget(parsed.data.action, parsed.data.target_id),
      last_run_at: null,
      last_run_key: null,
      last_error: null,
    };
    this.rules.push(rule);
    this.save();
    return this.toView(rule);
  }

  update(id: string, rawPatch: unknown): ScheduleRuleView {
    const index = this.rules.findIndex((entry) => entry.id === id);
    if (index < 0) throw new NotFoundError(`Zeitplan „${id}“ nicht gefunden`);
    const parsed = ScheduleRuleUpdateSchema.safeParse(rawPatch);
    if (!parsed.success) {
      throw new ValidationError(
        `Ungültiger Zeitplan: ${formatZodError(parsed.error)}`,
        parsed.error.issues,
      );
    }
    const current = this.rules[index]!;
    const action = parsed.data.action ?? current.action;
    const rawTarget = 'target_id' in parsed.data ? parsed.data.target_id : current.target_id;
    const updated: ScheduleRule = {
      ...current,
      name: parsed.data.name ?? current.name,
      enabled: parsed.data.enabled ?? current.enabled,
      days: parsed.data.days ? normalizeDays(parsed.data.days) : current.days,
      time: parsed.data.time ?? current.time,
      timezone: parsed.data.timezone ?? current.timezone,
      action,
      target_id: normalizeTarget(action, rawTarget),
    };
    this.rules[index] = updated;
    this.save();
    return this.toView(updated);
  }

  remove(id: string): void {
    const index = this.rules.findIndex((entry) => entry.id === id);
    if (index < 0) throw new NotFoundError(`Zeitplan „${id}“ nicht gefunden`);
    this.rules.splice(index, 1);
    this.save();
  }

  start(): void {
    this.stop();
    const intervalMs = this.options.tickIntervalMs ?? 15_000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async runNow(id: string): Promise<ScheduleRuleView> {
    const rule = this.rules.find((entry) => entry.id === id);
    if (!rule) throw new NotFoundError(`Zeitplan „${id}“ nicht gefunden`);
    await this.executeRule(rule, new Date());
    return this.toView(rule);
  }

  async tick(now = new Date()): Promise<string[]> {
    if (this.ticking) return [];
    this.ticking = true;
    const triggered: string[] = [];
    try {
      for (const rule of this.rules) {
        if (!rule.enabled || !isValidTimeZone(rule.timezone)) continue;
        const { day, hhmm, minuteKey } = localTimeParts(now, rule.timezone);
        if (!rule.days.includes(day) || hhmm !== rule.time) continue;
        if (rule.last_run_key === minuteKey) continue;

        rule.last_run_key = minuteKey;
        triggered.push(rule.id);
        await this.executeRule(rule, now);
      }
    } finally {
      this.ticking = false;
    }
    return triggered;
  }

  private async executeRule(rule: ScheduleRule, now: Date): Promise<void> {
    rule.last_run_at = now.toISOString();
    rule.last_error = null;
    this.save();
    try {
      await this.options.executor.execute(structuredClone(rule));
      rule.last_error = null;
      this.save();
      this.options.logger.info(
        { scheduleId: rule.id, name: rule.name, action: rule.action, target: rule.target_id },
        'Zeitplan ausgeführt',
      );
      this.options.audit?.record({
        actor: `scheduler:${rule.name}`,
        source: 'system',
        action: `schedule.${rule.action}`,
        target: rule.target_id,
        result: 'ok',
      });
    } catch (error) {
      const message = toErrorMessage(error);
      rule.last_error = message;
      this.save();
      this.options.logger.warn(
        { scheduleId: rule.id, name: rule.name, err: message },
        'Zeitplan-Ausführung fehlgeschlagen',
      );
      this.options.audit?.record({
        actor: `scheduler:${rule.name}`,
        source: 'system',
        action: `schedule.${rule.action}`,
        target: rule.target_id,
        result: 'error',
        detail: message,
      });
    }
  }
}
