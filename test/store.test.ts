import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashListing } from "../src/drafts/diff.js";
import { DraftStore } from "../src/drafts/store.js";
import { makeConfig, PKG } from "./helpers.js";

const base = { title: "A", shortDescription: "B", fullDescription: "C", video: "" };

async function store() {
  const config = await makeConfig();
  return new DraftStore(config.draftDir);
}

describe("DraftStore", () => {
  it("creates, lists and reads drafts", async () => {
    const s = await store();
    const { draft, file } = await s.create({ packageName: PKG, language: "nb-NO", base, proposed: { title: "Ny" } });
    expect(file).toContain(draft.draftId);
    expect(draft.base_hash).toBe(hashListing(base));
    const { drafts } = await s.list();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ draftId: draft.draftId, changedFields: ["title"] });
    expect((await s.list({ packageName: "no.other.app" })).drafts).toHaveLength(0);
    expect((await s.read(draft.draftId)).draft.proposed).toEqual({ title: "Ny" });
  });

  it("rejects path traversal in package, language and id", async () => {
    const s = await store();
    await expect(s.create({ packageName: "..", language: "nb-NO", base, proposed: {} })).rejects.toThrow();
    await expect(s.create({ packageName: PKG, language: "../..", base, proposed: {} })).rejects.toThrow();
    await expect(s.read("../../etc/passwd")).rejects.toThrow(/draftId/);
  });

  it("rejects tampered drafts", async () => {
    const s = await store();
    const { draft, file } = await s.create({ packageName: PKG, language: "nb-NO", base, proposed: { title: "Ny" } });
    const raw = JSON.parse(await readFile(file, "utf8"));

    await writeFile(file, JSON.stringify({ ...raw, base: { ...raw.base, title: "Endret" } }));
    await expect(s.read(draft.draftId)).rejects.toThrow(/base_hash/);

    await writeFile(file, JSON.stringify({ ...raw, packageName: "no.example.app2" }));
    await expect(s.read(draft.draftId)).rejects.toThrow(/ugyldig/);

    await writeFile(file, JSON.stringify({ ...raw, proposed: { title: "x", evil: "y" } }));
    await expect(s.read(draft.draftId)).rejects.toThrow(/ugyldig/);

    await writeFile(file, "not json");
    await expect(s.read(draft.draftId)).rejects.toThrow(/ugyldig/);
    expect((await s.list()).invalid).toBe(1);
  });

  it("rejects inconsistent new-listing base and hash values", async () => {
    const s = await store();
    const { draft, file } = await s.create({
      packageName: PKG,
      language: "pt-BR",
      base: null,
      proposed: { title: "A", shortDescription: "B", fullDescription: "C" },
    });
    const raw = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...raw, base_hash: hashListing(base) }));
    await expect(s.read(draft.draftId)).rejects.toThrow(/ugyldig/);
    await writeFile(file, JSON.stringify({ ...raw, base }));
    await expect(s.read(draft.draftId)).rejects.toThrow(/ugyldig/);
  });

  it("moves applied drafts to applied/ and refuses a second read", async () => {
    const s = await store();
    const { draft, file } = await s.create({ packageName: PKG, language: "nb-NO", base, proposed: { title: "Ny" } });
    const target = await s.markApplied(draft, file, { ok: true });
    expect(JSON.parse(await readFile(target, "utf8")).playResponse).toEqual({ ok: true });
    expect(await s.isApplied(draft.draftId)).toBe(true);
    await expect(s.read(draft.draftId)).rejects.toThrow(/allerede publisert/);
    expect((await s.list()).drafts).toHaveLength(0);
    expect(await readdir(join(s.root, "applied"))).toHaveLength(1);
  });

  it("ignores stray directories with invalid names", async () => {
    const s = await store();
    await mkdir(join(s.root, "not a package"), { recursive: true });
    expect((await s.list()).drafts).toEqual([]);
  });
});
