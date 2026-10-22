import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { buildDiff } from "../drafts/diff.js";
import { getListing } from "../play/listings.js";
import {
  assertLanguage,
  assertPackageName,
  assertValidProposal,
  FIELDS,
  UserError,
  type Proposal,
} from "../validation.js";
import { assertAllowed, jsonResult, runTool, type ToolContext } from "./common.js";

export const proposeShape = {
  packageName: z.string().describe("Android package name, e.g. no.example.app"),
  language: z.string().describe("BCP-47 language code, e.g. nb-NO"),
  title: z.string().optional().describe("New title, max 30 characters"),
  shortDescription: z.string().optional().describe("New short description, max 80 characters"),
  fullDescription: z.string().optional().describe("New full description, max 4000 characters"),
  video: z.string().optional().describe("New video URL; empty string removes the video"),
};

export type ProposeInput = {
  packageName: string;
  language: string;
} & Proposal;

export async function proposeHandler(ctx: ToolContext, input: ProposeInput): Promise<CallToolResult> {
  return runTool(ctx, "propose_listing_update", async () => {
    assertPackageName(input.packageName);
    assertLanguage(input.language);
    assertAllowed(ctx.config, input.packageName);

    const proposed: Proposal = {};
    for (const f of FIELDS) {
      if (input[f] !== undefined) proposed[f] = input[f];
    }
    assertValidProposal(proposed);

    const live = await getListing(ctx.play(), input.packageName, input.language, ctx.logger);
    const base = {
      title: live.title,
      shortDescription: live.shortDescription,
      fullDescription: live.fullDescription,
      video: live.video,
    };
    const diff = buildDiff(base, proposed);
    if (!diff.some((d) => d.changed)) {
      throw new UserError("Forslaget er identisk med live-oppføringen. Ingen utkast opprettet.");
    }

    const { draft } = await ctx.store.create({
      packageName: input.packageName,
      language: input.language,
      base,
      proposed,
    });
    ctx.logger.info(`Utkast ${draft.draftId} opprettet for ${draft.packageName} (${draft.language}).`);
    return jsonResult({
      draftId: draft.draftId,
      packageName: draft.packageName,
      language: draft.language,
      createdAt: draft.createdAt,
      diff,
    });
  });
}

export function registerPropose(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "propose_listing_update",
    {
      title: "Propose listing update",
      description:
        "Validates proposed listing texts against Google Play limits and saves a LOCAL draft with a diff. Does not write to Google Play.",
      inputSchema: proposeShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (input) => proposeHandler(ctx, input),
  );
}
