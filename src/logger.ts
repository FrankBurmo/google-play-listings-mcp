export type LogLevel = "error" | "warn" | "info" | "debug";

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

/** Logs to stderr only; stdout is reserved for the MCP protocol. */
export function createLogger(level: LogLevel): Logger {
  const log = (lvl: LogLevel) => (message: string) => {
    if (ORDER[lvl] <= ORDER[level]) {
      process.stderr.write(`[${new Date().toISOString()}] ${lvl.toUpperCase()} ${message}\n`);
    }
  };
  return { error: log("error"), warn: log("warn"), info: log("info"), debug: log("debug") };
}

export const silentLogger: Logger = {
  error() {},
  warn() {},
  info() {},
  debug() {},
};
