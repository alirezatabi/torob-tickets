/**
 * Structured, sanitised logging for provider diagnostics.
 *
 * Provider errors are noisy and sometimes contain URLs with tokens. Two rules:
 *   1. everything stays on the server (`console`), never in an HTTP response;
 *   2. before logging, strings are scrubbed of long tokens/query secrets.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined;
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/api[_-]?key=[^&\s]+/gi, "api_key=***"],
  [/access[_-]?token=[^&\s]+/gi, "access_token=***"],
  [/authorization:\s*[^\s]+/gi, "authorization: ***"],
  [/bearer\s+[A-Za-z0-9._-]+/gi, "bearer ***"],
  [/("?(?:client_secret|api_key|password)"?\s*:\s*)"[^"]*"/gi, '$1"***"'],
];

export function scrub(text: string): string {
  return SECRET_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

function format(level: LogLevel, event: string, fields: LogFields): string {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${scrub(String(value))}`);
  return [`[provider:${level}]`, event, ...parts].join(" ");
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export function createLogger(scope: string): Logger {
  const emit = (level: LogLevel) => (event: string, fields: LogFields = {}) => {
    const line = format(level, `${scope}.${event}`, fields);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else if (process.env.NODE_ENV !== "test") console.log(line);
  };

  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}

/** A logger that records lines for assertions in tests. */
export function createMemoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: LogLevel) => (event: string, fields: LogFields = {}) => {
    lines.push(format(level, event, fields));
  };
  return { lines, debug: push("debug"), info: push("info"), warn: push("warn"), error: push("error") };
}
