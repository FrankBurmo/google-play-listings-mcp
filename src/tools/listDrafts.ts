import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { assertLanguage, assertPackageName } from "../validation.js";
import { assertAllowed, jsonResult, runTool, type ToolContext } from "./common.js";

export const listDraftsShape = {
  packageName: z.string().optional().describe("Only drafts for this package"),
  language: z.string().optional().describe("Only drafts for this language"),
};

export async function listDraftsHandler(
  ctx: ToolContext,
  input: { packageName?: string | undefined; language?: string | undefined },
): Promise<CallToolResult> {
  return runTool(ctx, "list_drafts", async () => {
    const filter: { packageName?: string; language?: string } = {};
    if (input.packageName !== undefined) {
      assertPackageName(input.packageName);
      assertAllowed(ctx.config, input.packageName);
      filter.packageName = input.packageName;
    }
    if (input.language !== undefined) {
      assertLanguage(input.language);
      filter.language = input.language;
    }
    const { drafts, invalid } = await ctx.store.list(filter);
    const visible = drafts.filter((d) => ctx.config.allowedPackages.includes(d.packageName));
    return jsonResult({ drafts: visible, invalidFilesSkipped: invalid });
  });
}

export function registerListDrafts(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_drafts",
    {
      title: "List drafts",
      description: "Lists saved local drafts (id, time, changed fields), optionally filtered by package and language.",
      inputSchema: listDraftsShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (input) => listDraftsHandler(ctx, input),
  );
}
