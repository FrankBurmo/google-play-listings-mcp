import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { buildDiff } from "../drafts/diff.js";
import { assertAllowed, jsonResult, runTool, type ToolContext } from "./common.js";

export const getDraftShape = {
  draftId: z.string().describe("Draft id (UUID) from propose_listing_update or list_drafts"),
};

export async function getDraftHandler(ctx: ToolContext, input: { draftId: string }): Promise<CallToolResult> {
  return runTool(ctx, "get_draft", async () => {
    const { draft } = await ctx.store.read(input.draftId);
    assertAllowed(ctx.config, draft.packageName);
    return jsonResult({
      draftId: draft.draftId,
      packageName: draft.packageName,
      language: draft.language,
      createdAt: draft.createdAt,
      base_hash: draft.base_hash,
      base: draft.base,
      proposed: draft.proposed,
      diff: buildDiff(draft.base, draft.proposed),
    });
  });
}

export function registerGetDraft(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_draft",
    {
      title: "Get draft",
      description: "Shows one full local draft with a per-field diff and character counts (read-only).",
      inputSchema: getDraftShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (input) => getDraftHandler(ctx, input),
  );
}
