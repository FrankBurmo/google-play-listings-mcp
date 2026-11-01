import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { Config } from "../src/config.js";
import { DraftStore } from "../src/drafts/store.js";
import { silentLogger } from "../src/logger.js";
import type { PublisherLike } from "../src/play/listings.js";
import type { ToolContext } from "../src/tools/common.js";

export const PKG = "no.example.app1";

export function apiError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { code: status });
}

export interface FakeOptions {
  listing?: Record<string, string>;
  listings?: Record<string, string>[];
}

export function fakePublisher(opts: FakeOptions = {}) {
  const listing = opts.listing ?? {
    language: "nb-NO",
    title: "Gammel tittel",
    shortDescription: "Gammel kort",
    fullDescription: "Gammel lang",
    video: "",
  };
  const calls: string[] = [];
  const edits = {
    insert: vi.fn(async () => {
      calls.push("insert");
      return { data: { id: "edit-1" } };
    }),
    delete: vi.fn(async () => {
      calls.push("delete");
      return {};
    }),
    validate: vi.fn(async () => {
      calls.push("validate");
      return {};
    }),
    commit: vi.fn(async () => {
      calls.push("commit");
      return { data: { id: "edit-1" } };
    }),
    listings: {
      list: vi.fn(async () => {
        calls.push("list");
        return { data: { listings: opts.listings ?? [listing] } };
      }),
      get: vi.fn(async () => {
        calls.push("get");
        return { data: listing };
      }),
      patch: vi.fn(async () => {
        calls.push("patch");
        return { data: {} };
      }),
      update: vi.fn(async () => {
        calls.push("update");
        return { data: {} };
      }),
    },
  };
  return { api: { edits } as unknown as PublisherLike, edits, calls, listing };
}

export async function makeConfig(overrides: Partial<Config> = {}): Promise<Config> {
  const dir = await mkdtemp(join(tmpdir(), "plm-"));
  return {
    keyFile: join(dir, "key.json"),
    allowedPackages: [PKG, "no.example.app2"],
    draftDir: join(dir, "drafts"),
    enableApply: true,
    logLevel: "error",
    ...overrides,
  };
}

export async function makeContext(api: PublisherLike, overrides: Partial<Config> = {}): Promise<ToolContext> {
  const config = await makeConfig(overrides);
  await writeFile(config.keyFile, "{}");
  return { config, logger: silentLogger, store: new DraftStore(config.draftDir), play: () => api };
}

export function textOf(result: { content: unknown }): string {
  const first = (result.content as { type: string; text: string }[])[0];
  return first?.text ?? "";
}

export function dataOf(result: { content: unknown }): any {
  return JSON.parse(textOf(result)).data;
}
