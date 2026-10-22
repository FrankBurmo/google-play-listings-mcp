import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { listListings } from "../play/listings.js";
import { countChars, assertPackageName } from "../validation.js";
import { assertAllowed, jsonResult, runTool, type ToolContext } from "./common.js";

export const listListingsShape = {
  packageName: z.string().describe("Android package name, e.g. no.example.app"),
};

export async function listListingsHandler(ctx: ToolContext, input: { packageName: string }): Promise<CallToolResult> {
  return runTool(ctx, "list_listings", async () => {
    assertPackageName(input.packageName);
    assertAllowed(ctx.config, input.packageName);
    const listings = await listListings(ctx.play(), input.packageName, ctx.logger);
    return jsonResult({
      packageName: input.packageName,
      listings: listings.map((l) => ({
        ...l,
        lengths: {
          title: countChars(l.title),
          shortDescription: countChars(l.shortDescription),
          fullDescription: countChars(l.fullDescription),
        },
      })),
    });
  });
}

export function registerListListings(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_listings",
    {
      title: "List listings",
      description: "Returns all localized store listings for an app (read-only).",
      inputSchema: listListingsShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (input) => listListingsHandler(ctx, input),
  );
}
