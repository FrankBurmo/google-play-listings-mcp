import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { hashListing } from "../drafts/diff.js";
import { getListing, patchListing } from "../play/listings.js";
import { assertValidProposal, UserError } from "../validation.js";
import { assertAllowed, jsonResult, runTool, type ToolContext } from "./common.js";

export const applyDraftShape = {
  draftId: z.string().describe("Draft id (UUID)"),
  confirm: z.literal(true).describe("Must be literally true"),
  confirmPackageName: z.string().describe("Must equal the draft's package name"),
};

const inFlight = new Set<string>();

export async function applyDraftHandler(
  ctx: ToolContext,
  input: { draftId: string; confirm: unknown; confirmPackageName: string },
): Promise<CallToolResult> {
  return runTool(ctx, "apply_draft", async () => {
    if (input.confirm !== true) {
      throw new UserError("confirm må være bokstavelig true.");
    }
    const { draft, file } = await ctx.store.read(input.draftId);
    assertAllowed(ctx.config, draft.packageName);
    if (input.confirmPackageName !== draft.packageName) {
      throw new UserError("confirmPackageName stemmer ikke med utkastets pakkenavn. Ingenting er publisert.");
    }
    if (inFlight.has(draft.draftId)) {
      throw new UserError("Utkastet publiseres allerede.");
    }
    inFlight.add(draft.draftId);
    try {
      const live = await getListing(ctx.play(), draft.packageName, draft.language, ctx.logger);
      if (hashListing(live) !== draft.base_hash) {
        throw new UserError(
          "Live-oppføringen er endret siden utkastet ble laget (base_hash stemmer ikke). Ingenting er publisert. Lag et nytt utkast.",
        );
      }
      assertValidProposal(draft.proposed);

      const response = await patchListing(ctx.play(), draft.packageName, draft.language, draft.proposed, ctx.logger);
      ctx.logger.info(`Utkast ${draft.draftId} publisert for ${draft.packageName} (${draft.language}).`);

      let archived: string | undefined;
      try {
        archived = await ctx.store.markApplied(draft, file, response);
      } catch {
        ctx.logger.error(`Utkast ${draft.draftId} er publisert, men kunne ikke flyttes til applied/.`);
        throw new UserError(
          `Publiseringen til Google Play lyktes, men utkastet kunne ikke flyttes til applied/. Ikke publiser ${draft.draftId} på nytt.`,
        );
      }
      return jsonResult({
        status: "published",
        draftId: draft.draftId,
        packageName: draft.packageName,
        language: draft.language,
        archivedAs: archived,
        playResponse: response,
      });
    } finally {
      inFlight.delete(draft.draftId);
    }
  });
}

export function registerApplyDraft(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "apply_draft",
    {
      title: "Apply draft (publish to Google Play)",
      description:
        "PUBLISHES a saved draft to Google Play. Only call when the developer has explicitly asked to publish this specific draft in the same message. Requires confirm=true and confirmPackageName.",
      inputSchema: applyDraftShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    (input) => applyDraftHandler(ctx, input),
  );
}
