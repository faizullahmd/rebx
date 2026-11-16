export type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY_PATTERN =
  /(secret|token|authorization|password|api[-_]?key|credential|cookie)/i;

export function redactSensitiveString(
  input: string,
  extraSecrets: readonly string[] = [],
): string {
  let out = input.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  for (const secret of extraSecrets) {
    const clean = secret.trim();
    if (clean.length >= 4 && out.includes(clean)) {
      out = out.split(clean).join("[REDACTED]");
    }
  }
  return out;
}

export function sanitizeLogValue(
  value: unknown,
  extraSecrets: readonly string[] = [],
  depth = 0,
): unknown {
  if (depth > 5) return "[Truncated]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return redactSensitiveString(value, extraSecrets);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveString(value.message, extraSecrets),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, extraSecrets, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = sanitizeLogValue(v, extraSecrets, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export interface WorkerLogger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export type WorkerLogEntry = {
  timestamp: string;
  level: LogLevel;
  service: string;
  workerId: string;
  message: string;
  meta?: Record<string, unknown>;
};

export function createWorkerLogger(params: {
  workerId: string;
  secrets?: readonly string[];
  sink?: (entry: WorkerLogEntry, line: string) => void;
}): WorkerLogger {
  const secrets = (params.secrets ?? []).filter((s) => Boolean(s?.trim()));
  const sink =
    params.sink ??
    ((entry: WorkerLogEntry, line: string) => {
      if (entry.level === "error" || entry.level === "warn") {
        console.error(line);
      } else {
        console.log(line);
      }
    });

  function emit(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    const entry: WorkerLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: "rebx-video-renderer",
      workerId: params.workerId,
      message: redactSensitiveString(message, secrets),
      ...(meta ? { meta: sanitizeLogValue(meta, secrets) as Record<string, unknown> } : {}),
    };
    const serialized = JSON.stringify(entry);
    sink(entry, serialized);
  }

  return {
    debug: (msg, meta) => emit("debug", msg, meta),
    info: (msg, meta) => emit("info", msg, meta),
    warn: (msg, meta) => emit("warn", msg, meta),
    error: (msg, meta) => emit("error", msg, meta),
  };
}

