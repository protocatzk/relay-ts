import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Logger } from 'pino';
import { toErrorMessage } from './errors.js';

export type ProcessStream = 'stdout' | 'stderr';

export interface ManagedProcessOptions {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logger: Logger;
  redact?: (text: string) => string;
  onLine?: (line: string, stream: ProcessStream) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  killTimeoutMs?: number;
}

const MAX_RECENT_LINES = 200;

/**
 * Thin wrapper around a long-running child process (ffmpeg, pause encoder, ...).
 * Handles graceful shutdown, line-based log capture and repeated-exit safety.
 */
export class ManagedProcess {
  readonly name: string;
  private readonly options: ManagedProcessOptions;
  private child?: ChildProcess;
  private exited = false;
  private stopping = false;
  private exitPromise?: Promise<void>;
  private readonly recentLines: string[] = [];
  private startedAtValue?: Date;

  constructor(options: ManagedProcessOptions) {
    this.name = options.name;
    this.options = options;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get running(): boolean {
    return Boolean(this.child) && !this.exited;
  }

  get startedAt(): Date | null {
    return this.startedAtValue ?? null;
  }

  get lastLines(): string[] {
    return [...this.recentLines];
  }

  start(): void {
    if (this.child) return;
    const redact = this.options.redact ?? ((text: string) => text);
    this.options.logger.info(
      { process: this.name, command: this.options.command, args: this.options.args.map(redact) },
      'Prozess wird gestartet',
    );
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.startedAtValue = new Date();
    this.exited = false;

    const handleLine = (rawLine: string, stream: ProcessStream) => {
      const line = redact(rawLine).trimEnd();
      if (!line) return;
      this.recentLines.push(`${stream}: ${line}`);
      if (this.recentLines.length > MAX_RECENT_LINES) this.recentLines.shift();
      this.options.onLine?.(line, stream);
    };

    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => handleLine(line, 'stdout'));
    }
    if (child.stderr) {
      createInterface({ input: child.stderr }).on('line', (line) => handleLine(line, 'stderr'));
    }

    child.once('error', (error) => {
      this.options.logger.error(
        { process: this.name, err: toErrorMessage(error) },
        'Prozess konnte nicht gestartet werden',
      );
      this.finish(null, null, 1);
    });

    child.once('exit', (code, signal) => {
      this.finish(code, signal, code ?? 1);
    });
  }

  private finish(code: number | null, signal: NodeJS.Signals | null, exitCode: number): void {
    if (this.exited) return;
    this.exited = true;
    const wasStopping = this.stopping;
    this.stopping = false;
    if (wasStopping) {
      this.options.logger.info({ process: this.name, code, signal }, 'Prozess beendet');
    } else {
      const level = exitCode === 0 ? 'info' : 'warn';
      this.options.logger[level]({ process: this.name, code, signal }, 'Prozess wurde beendet');
    }
    this.options.onExit?.(code, signal);
    this.child = undefined;
  }

  async stop(timeoutMs = this.options.killTimeoutMs ?? 5000): Promise<void> {
    const child = this.child;
    if (!child || this.exited) return;
    this.stopping = true;
    this.options.logger.debug({ process: this.name, pid: child.pid }, 'Prozess wird gestoppt');
    this.exitPromise = new Promise<void>((resolve) => {
      if (!child || this.exited) return resolve();
      child.once('exit', () => resolve());
      setTimeout(resolve, timeoutMs + 1000);
    });
    try {
      child.kill('SIGTERM');
    } catch (error) {
      this.options.logger.debug({ process: this.name, err: toErrorMessage(error) }, 'SIGTERM fehlgeschlagen');
    }
    const timer = setTimeout(() => {
      if (!this.exited && this.child) {
        try {
          this.child.kill('SIGKILL');
        } catch {
          // already gone
        }
      }
    }, timeoutMs);
    await this.exitPromise;
    clearTimeout(timer);
  }
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface RunCommandOptions {
  timeoutMs?: number;
  logger?: Logger;
  redact?: (text: string) => string;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxOutputBytes ?? 4 * 1024 * 1024;
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      settled = true;
      reject(new Error(`${command} Timeout nach ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString();
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`${command} konnte nicht gestartet werden: ${toErrorMessage(error)}`));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const redact = options.redact ?? ((text: string) => text);
      if (stderr) options.logger?.debug({ command, stderr: redact(stderr.slice(-4000)) }, 'Befehl beendet');
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

/** Serializes async operations (start/stop/switch must never interleave). */
export class AsyncLock {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
