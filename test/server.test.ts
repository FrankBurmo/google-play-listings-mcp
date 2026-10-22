import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { silentLogger } from "../src/logger.js";
import { createServer } from "../src/server.js";
import { fakePublisher, makeConfig } from "./helpers.js";

async function connect(enableApply: boolean) {
  const config = await makeConfig({ enableApply });
  const server = createServer(config, silentLogger, () => fakePublisher().api);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("server tool registration", () => {
  it("hides apply_draft unless PLAY_ENABLE_APPLY=true", async () => {
    const names = (await (await connect(false)).listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_apps",
        "list_listings",
        "get_listing",
        "propose_listing_update",
        "list_drafts",
        "get_draft",
      ]),
    );
    expect(names).not.toContain("apply_draft");
  });

  it("registers apply_draft with destructive annotations when enabled", async () => {
    const tools = (await (await connect(true)).listTools()).tools;
    const apply = tools.find((t) => t.name === "apply_draft");
    expect(apply?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it("annotates read tools as read-only", async () => {
    const tools = (await (await connect(false)).listTools()).tools;
    for (const name of ["list_apps", "list_listings", "get_listing", "list_drafts", "get_draft"]) {
      expect(tools.find((t) => t.name === name)?.annotations?.readOnlyHint).toBe(true);
    }
    expect(tools.find((t) => t.name === "propose_listing_update")?.annotations?.destructiveHint).toBe(false);
  });

  it("rejects apply_draft input without literal confirm=true at the schema level", async () => {
    const client = await connect(true);
    const res = await client
      .callTool({
        name: "apply_draft",
        arguments: { draftId: "x", confirm: "true", confirmPackageName: "no.example.app1" },
      })
      .catch((e: unknown) => e);
    const failed = res instanceof Error || (res as { isError?: boolean }).isError === true;
    expect(failed).toBe(true);
  });
});
