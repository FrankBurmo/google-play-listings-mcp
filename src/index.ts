#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { createLogger } from "./logger.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : "Kunne ikke lese konfigurasjon.";
    process.stderr.write(`play-listings-mcp: ${message}\n`);
    process.exit(1);
  }
  const logger = createLogger(config.logLevel);
  const server = createServer(config, logger);
  await server.connect(new StdioServerTransport());
  logger.info(
    `Server startet. Apper: ${config.allowedPackages.length}, apply_draft: ${config.enableApply ? "på" : "av"}.`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`play-listings-mcp: fatal feil: ${err instanceof Error ? err.name : "ukjent"}\n`);
  process.exit(1);
});
