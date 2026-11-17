export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super('config_invalid', message, 500, details);
    this.name = 'ConfigError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('validation_failed', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super('not_found', message, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('conflict', message, 409);
    this.name = 'ConflictError';
  }
}

export class ResolveError extends AppError {
  constructor(message: string, details?: unknown) {
    super('resolve_failed', message, 502, details);
    this.name = 'ResolveError';
  }
}

export class StreamerOfflineError extends AppError {
  constructor(message = 'Der Streamer ist aktuell nicht live') {
    super('streamer_offline', message, 409);
    this.name = 'StreamerOfflineError';
  }
}

export class MissingStreamKeyError extends AppError {
  constructor(message = 'Für diesen Streamer ist kein YouTube-Stream-Key hinterlegt') {
    super('missing_stream_key', message, 400);
    this.name = 'MissingStreamKeyError';
  }
}

export class SourceError extends AppError {
  constructor(message: string, details?: unknown) {
    super('source_failed', message, 502, details);
    this.name = 'SourceError';
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
