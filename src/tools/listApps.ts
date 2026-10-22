import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { jsonResult, runTool, type ToolContext } from "./common.js";

export async function listAppsHandler(ctx: ToolContext): Promise<CallToolResult> {
  return runTool(ctx, "list_apps", async () => jsonResult({ packages: ctx.config.allowedPackages }));
}

export function registerListApps(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_apps",
    {
      title: "List apps",
      description: "Lists the Android package names this server is allowed to work with (PLAY_ALLOWED_PACKAGES).",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    () => listAppsHandler(ctx),
  );
}
