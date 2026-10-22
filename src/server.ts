import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { DraftStore } from "./drafts/store.js";
import type { Logger } from "./logger.js";
import { createPublisher } from "./play/client.js";
import type { PublisherLike } from "./play/listings.js";
import { registerApplyDraft } from "./tools/applyDraft.js";
import type { ToolContext } from "./tools/common.js";
import { registerGetDraft } from "./tools/getDraft.js";
import { registerGetListing } from "./tools/getListing.js";
import { registerListApps } from "./tools/listApps.js";
import { registerListDrafts } from "./tools/listDrafts.js";
import { registerListListings } from "./tools/listListings.js";
import { registerPropose } from "./tools/proposeListingUpdate.js";

export const SERVER_NAME = "play-listings-mcp";
export const SERVER_VERSION = "1.0.0";

export function createServer(config: Config, logger: Logger, publisher?: () => PublisherLike): McpServer {
  let client: PublisherLike | undefined;
  const ctx: ToolContext = {
    config,
    logger,
    store: new DraftStore(config.draftDir),
    play: publisher ?? (() => (client ??= createPublisher(config))),
  };

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerListApps(server, ctx);
  registerListListings(server, ctx);
  registerGetListing(server, ctx);
  registerPropose(server, ctx);
  registerListDrafts(server, ctx);
  registerGetDraft(server, ctx);
  if (config.enableApply) {
    registerApplyDraft(server, ctx);
  }
  return server;
}
