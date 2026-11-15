import { appendFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export type WorkerLogLevel = "info" | "warn" | "error";
export interface WorkerLogEntry {
  level: WorkerLogLevel;
  event: string;
  message?: string;
  cycleId?: string;
  source?: string;
  route?: string;
  date?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}
export interface WorkerLoggerOptions {
  directory?: string;
  fileName?: string;
  maxBytes?: number;
  backups?: number;
  consoleOutput?: boolean;
}

const DEFAULT_DIRECTORY = join(process.cwd(), "data", "crawl", "logs");
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_BACKUPS = 3;
const SENSITIVE_KEY = /secret|token|authorization|cookie|session.?id|request.?template|password/i;

/** Structured JSONL logs with bounded disk usage and defensive redaction. */
export class CrawlWorkerLogger {
  private readonly directory: string;
  private readonly fileName: string;
  private readonly maxBytes: number;
  private readonly backups: number;
  private readonly consoleOutput: boolean;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: WorkerLoggerOptions = {}) {
    this.directory = options.directory ?? DEFAULT_DIRECTORY;
    this.fileName = options.fileName ?? "worker.jsonl";
    this.maxBytes = Math.max(1024, options.maxBytes ?? DEFAULT_MAX_BYTES);
    this.backups = Math.max(0, Math.floor(options.backups ?? DEFAULT_BACKUPS));
    this.consoleOutput = options.consoleOutput ?? true;
  }

  async log(entry: WorkerLogEntry): Promise<void> {
    const record = redact({ timestamp: new Date().toISOString(), ...entry }, process.env.SECRET_TOROB);
    const line = `${JSON.stringify(record)}\n`;
    if (this.consoleOutput) {
      if (entry.level === "error") console.error(line.trimEnd());
      else if (entry.level === "warn") console.warn(line.trimEnd());
      else console.info(line.trimEnd());
    }
    this.queue = this.queue.then(() => this.append(line)).catch((error: unknown) => {
      // Keep console diagnostics available if the local log volume is unwritable/full.
      const detail = error instanceof Error ? error.message : "unknown file error";
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", event: "worker.log_write_failed", message: redactText(detail, process.env.SECRET_TOROB) }));
    });
    await this.queue;
  }

  private async append(line: string): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const active = join(this.directory, this.fileName);
    const currentSize = await stat(active).then((info) => info.size).catch((error: unknown) => {
      if (isNotFound(error)) return 0;
      throw error;
    });
    if (currentSize > 0 && currentSize + Buffer.byteLength(line) > this.maxBytes) await this.rotate(active);
    await appendFile(active, line, { encoding: "utf8", mode: 0o600 });
  }

  private async rotate(active: string): Promise<void> {
    if (this.backups === 0) { await unlink(active).catch(() => undefined); return; }
    for (let index = this.backups; index >= 1; index -= 1) {
      const from = index === 1 ? active : `${active}.${index - 1}`;
      const to = `${active}.${index}`;
      await unlink(to).catch(() => undefined);
      if (index === 1 || await exists(from)) await rename(from, to);
    }
  }
}

export const crawlWorkerLogger = new CrawlWorkerLogger();

function redact(value: unknown, secret: string | undefined, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactText(value, secret);
  if (Array.isArray(value)) return value.map((item) => redact(item, secret));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, secret, childKey)]));
  }
  return value;
}
function redactText(value: string, secret: string | undefined): string {
  let safe = value;
  if (secret?.trim()) safe = safe.replaceAll(secret, "[REDACTED]");
  return safe.replace(/(SECRET_TOROB\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}
async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}
function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
