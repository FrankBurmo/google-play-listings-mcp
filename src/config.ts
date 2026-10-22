import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { parseAllowedPackages, UserError } from "./validation.js";
import type { LogLevel } from "./logger.js";

export interface Config {
  keyFile: string;
  allowedPackages: string[];
  draftDir: string;
  enableApply: boolean;
  logLevel: LogLevel;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

const EnvSchema = z.object({
  PLAY_KEY_FILE: z.string().trim().min(1, "mangler"),
  PLAY_ALLOWED_PACKAGES: z.string().trim().min(1, "mangler"),
  PLAY_DRAFT_DIR: z.string().trim().min(1).optional(),
  PLAY_ENABLE_APPLY: z.enum(["true", "false"]).optional(),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).optional(),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse({
    PLAY_KEY_FILE: env.PLAY_KEY_FILE ?? "",
    PLAY_ALLOWED_PACKAGES: env.PLAY_ALLOWED_PACKAGES ?? "",
    PLAY_DRAFT_DIR: env.PLAY_DRAFT_DIR || undefined,
    PLAY_ENABLE_APPLY: env.PLAY_ENABLE_APPLY || undefined,
    LOG_LEVEL: env.LOG_LEVEL || undefined,
  });
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Ugyldig konfigurasjon:\n${lines.join("\n")}`);
  }
  const data = parsed.data;

  let allowedPackages: string[];
  try {
    allowedPackages = parseAllowedPackages(data.PLAY_ALLOWED_PACKAGES);
  } catch (err) {
    throw new ConfigError(err instanceof UserError ? err.message : "Ugyldig PLAY_ALLOWED_PACKAGES");
  }
  if (allowedPackages.length === 0) {
    throw new ConfigError("PLAY_ALLOWED_PACKAGES må inneholde minst ett pakkenavn.");
  }

  const keyFile = resolve(data.PLAY_KEY_FILE);
  try {
    accessSync(keyFile, constants.R_OK);
  } catch {
    throw new ConfigError(`PLAY_KEY_FILE peker på en fil som ikke finnes eller ikke kan leses: ${keyFile}`);
  }

  return {
    keyFile,
    allowedPackages,
    draftDir: resolve(data.PLAY_DRAFT_DIR ?? "./drafts"),
    enableApply: data.PLAY_ENABLE_APPLY === "true",
    logLevel: data.LOG_LEVEL ?? "info",
  };
}
