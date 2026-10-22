import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getListing } from "../play/listings.js";
import { assertLanguage, assertPackageName, countChars } from "../validation.js";
import { assertAllowed, jsonResult, runTool, type ToolContext } from "./common.js";

export const getListingShape = {
  packageName: z.string().describe("Android package name, e.g. no.example.app"),
  language: z.string().describe("BCP-47 language code, e.g. nb-NO or en-US"),
};

export async function getListingHandler(
  ctx: ToolContext,
  input: { packageName: string; language: string },
): Promise<CallToolResult> {
  return runTool(ctx, "get_listing", async () => {
    assertPackageName(input.packageName);
    assertLanguage(input.language);
    assertAllowed(ctx.config, input.packageName);
    const listing = await getListing(ctx.play(), input.packageName, input.language, ctx.logger);
    return jsonResult({
      packageName: input.packageName,
      listing,
      lengths: {
        title: countChars(listing.title),
        shortDescription: countChars(listing.shortDescription),
        fullDescription: countChars(listing.fullDescription),
      },
    });
  });
}

export function registerGetListing(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_listing",
    {
      title: "Get listing",
      description:
        "Returns one store listing (title, short/full description, video) with character counts (read-only).",
      inputSchema: getListingShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (input) => getListingHandler(ctx, input),
  );
}
