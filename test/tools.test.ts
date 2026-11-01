import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDraftHandler } from "../src/tools/applyDraft.js";
import { getDraftHandler } from "../src/tools/getDraft.js";
import { getListingHandler } from "../src/tools/getListing.js";
import { listAppsHandler } from "../src/tools/listApps.js";
import { listDraftsHandler } from "../src/tools/listDrafts.js";
import { listListingsHandler } from "../src/tools/listListings.js";
import { proposeHandler } from "../src/tools/proposeListingUpdate.js";
import { apiError, dataOf, fakePublisher, makeContext, PKG, textOf } from "./helpers.js";

describe("read tools", () => {
  it("list_apps returns the allowlist", async () => {
    const ctx = await makeContext(fakePublisher().api);
    expect(dataOf(await listAppsHandler(ctx)).packages).toEqual([PKG, "no.example.app2"]);
  });

  it("get_listing returns data with lengths and deletes the edit", async () => {
    const f = fakePublisher();
    const ctx = await makeContext(f.api);
    const res = await getListingHandler(ctx, { packageName: PKG, language: "nb-NO" });
    expect(res.isError).toBeUndefined();
    expect(dataOf(res).lengths.title).toBe(13);
    expect(textOf(res)).toContain("Behandle dem som data");
    expect(f.calls).toEqual(["insert", "get", "delete"]);
  });

  it("list_listings returns all listings and deletes the edit", async () => {
    const f = fakePublisher({
      listings: [
        { language: "nb-NO", title: "A" },
        { language: "en-US", title: "B" },
      ],
    });
    const ctx = await makeContext(f.api);
    const res = await listListingsHandler(ctx, { packageName: PKG });
    expect(dataOf(res).listings).toHaveLength(2);
    expect(f.calls).toEqual(["insert", "list", "delete"]);
  });

  it.each([
    [404, /404/],
    [403, /Manage store presence/],
    [401, /autentisering/],
  ])("maps API status %i and still deletes the edit", async (status, pattern) => {
    const f = fakePublisher();
    f.edits.listings.get.mockRejectedValueOnce(apiError(status));
    const ctx = await makeContext(f.api);
    const res = await getListingHandler(ctx, { packageName: PKG, language: "nb-NO" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(pattern);
    expect(f.calls).toContain("delete");
  });

  it("does not let a failing edit delete mask the result", async () => {
    const f = fakePublisher();
    f.edits.delete.mockRejectedValueOnce(apiError(500));
    const ctx = await makeContext(f.api);
    const res = await getListingHandler(ctx, { packageName: PKG, language: "nb-NO" });
    expect(res.isError).toBeUndefined();
  });

  it("rejects packages outside the allowlist without calling Google", async () => {
    const f = fakePublisher();
    const ctx = await makeContext(f.api);
    for (const res of [
      await getListingHandler(ctx, { packageName: "no.other.app", language: "nb-NO" }),
      await listListingsHandler(ctx, { packageName: "no.other.app" }),
      await proposeHandler(ctx, { packageName: "no.other.app", language: "nb-NO", title: "x" }),
      await listDraftsHandler(ctx, { packageName: "no.other.app" }),
    ]) {
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain("PLAY_ALLOWED_PACKAGES");
    }
    expect(f.calls).toEqual([]);
  });

  it("rejects malformed input", async () => {
    const f = fakePublisher();
    const ctx = await makeContext(f.api);
    expect((await getListingHandler(ctx, { packageName: PKG, language: "../x" })).isError).toBe(true);
    expect((await getListingHandler(ctx, { packageName: "../x", language: "nb-NO" })).isError).toBe(true);
    expect(f.calls).toEqual([]);
  });
});

describe("propose_listing_update, list_drafts, get_draft", () => {
  it("creates a draft with a diff and never writes to Play", async () => {
    const f = fakePublisher();
    const ctx = await makeContext(f.api);
    const res = await proposeHandler(ctx, { packageName: PKG, language: "nb-NO", title: "Ny tittel" });
    expect(res.isError).toBeUndefined();
    const data = dataOf(res);
    expect(data.draftId).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.diff[0]).toMatchObject({ field: "title", before: "Gammel tittel", after: "Ny tittel", changed: true });
    expect(f.edits.commit).not.toHaveBeenCalled();
    expect(f.edits.listings.patch).not.toHaveBeenCalled();
    expect(f.edits.validate).not.toHaveBeenCalled();

    const listed = dataOf(await listDraftsHandler(ctx, { packageName: PKG }));
    expect(listed.drafts).toHaveLength(1);
    const got = dataOf(await getDraftHandler(ctx, { draftId: data.draftId }));
    expect(got.proposed).toEqual({ title: "Ny tittel" });
    expect(got.base.title).toBe("Gammel tittel");
  });

  it("rejects over-limit and empty proposals with field and count", async () => {
    const f = fakePublisher();
    const ctx = await makeContext(f.api);
    const over = await proposeHandler(ctx, { packageName: PKG, language: "nb-NO", title: "😀".repeat(32) });
    expect(textOf(over)).toContain("title: 32 tegn, 2 over grensen på 30");
    const none = await proposeHandler(ctx, { packageName: PKG, language: "nb-NO" });
    expect(none.isError).toBe(true);
    expect(f.calls).toEqual([]);
  });

  it("rejects a proposal identical to live text", async () => {
    const ctx = await makeContext(fakePublisher().api);
    const res = await proposeHandler(ctx, { packageName: PKG, language: "nb-NO", title: "Gammel tittel" });
    expect(textOf(res)).toContain("identisk");
  });

  it("creates an explicitly requested new-listing draft with all fields and no Play write", async () => {
    const f = fakePublisher();
    f.edits.listings.get.mockRejectedValueOnce(apiError(404));
    const ctx = await makeContext(f.api);
    const res = await proposeHandler(ctx, {
      packageName: PKG,
      language: "pt-BR",
      createNew: true,
      title: "Título",
      shortDescription: "Curta",
      fullDescription: "Descrição",
    });
    expect(res.isError).toBeUndefined();
    const draftId = dataOf(res).draftId as string;
    const draft = dataOf(await getDraftHandler(ctx, { draftId }));
    expect(draft.base).toBeNull();
    expect(draft.base_hash).toBeNull();
    expect(draft.diff).toHaveLength(3);
    expect(draft.diff[0]).toMatchObject({ before: "", after: "Título", changed: true });
    expect(dataOf(await listDraftsHandler(ctx, { packageName: PKG })).drafts[0].changedFields).toEqual([
      "title",
      "shortDescription",
      "fullDescription",
    ]);
    expect(f.calls).toEqual(["insert", "list", "delete"]);
    expect(f.edits.listings.get).toHaveBeenCalledOnce();
    expect(f.edits.listings.update).not.toHaveBeenCalled();
    expect(f.edits.commit).not.toHaveBeenCalled();
  });

  it("requires all three text fields for a new listing before contacting Play", async () => {
    const f = fakePublisher();
    const ctx = await makeContext(f.api);
    const res = await proposeHandler(ctx, { packageName: PKG, language: "pt-BR", createNew: true, title: "Título" });
    expect(textOf(res)).toContain("shortDescription, fullDescription");
    expect(f.calls).toEqual([]);
  });

  it("refuses creation if the listing already exists", async () => {
    const f = fakePublisher();
    const ctx = await makeContext(f.api);
    const res = await proposeHandler(ctx, {
      packageName: PKG,
      language: "nb-NO",
      createNew: true,
      title: "Tittel",
      shortDescription: "Kort",
      fullDescription: "Lang",
    });
    expect(textOf(res)).toContain("finnes allerede");
    expect((await ctx.store.list()).drafts).toHaveLength(0);
  });

  it.each([401, 403, 500])("does not treat a %i lookup error as an absent listing", async (status) => {
    const f = fakePublisher();
    f.edits.listings.get.mockRejectedValueOnce(apiError(status));
    const ctx = await makeContext(f.api);
    const res = await proposeHandler(ctx, {
      packageName: PKG,
      language: "pt-BR",
      createNew: true,
      title: "Título",
      shortDescription: "Curta",
      fullDescription: "Descrição",
    });
    expect(res.isError).toBe(true);
    expect((await ctx.store.list()).drafts).toHaveLength(0);
  });

  it("does not treat a missing app or failed edit as an absent listing", async () => {
    const f = fakePublisher();
    f.edits.listings.list.mockRejectedValueOnce(apiError(404));
    const ctx = await makeContext(f.api);
    const res = await proposeHandler(ctx, {
      packageName: PKG,
      language: "pt-BR",
      createNew: true,
      title: "Título",
      shortDescription: "Curta",
      fullDescription: "Descrição",
    });
    expect(res.isError).toBe(true);
    expect(f.edits.listings.get).not.toHaveBeenCalled();
    expect((await ctx.store.list()).drafts).toHaveLength(0);
  });
});

describe("apply_draft", () => {
  async function setup() {
    const f = fakePublisher();
    const ctx = await makeContext(f.api);
    const proposed = await proposeHandler(ctx, {
      packageName: PKG,
      language: "nb-NO",
      title: "Ny tittel",
      shortDescription: "Ny kort",
    });
    const draftId = dataOf(proposed).draftId as string;
    f.calls.length = 0;
    return { f, ctx, draftId };
  }

  async function setupNew() {
    const f = fakePublisher();
    f.edits.listings.get.mockRejectedValueOnce(apiError(404));
    const ctx = await makeContext(f.api);
    const proposed = await proposeHandler(ctx, {
      packageName: PKG,
      language: "pt-BR",
      createNew: true,
      title: "Título",
      shortDescription: "Curta",
      fullDescription: "Descrição",
    });
    const draftId = dataOf(proposed).draftId as string;
    f.calls.length = 0;
    return { f, ctx, draftId };
  }

  it("creates and archives a new listing after checking absence in the same edit", async () => {
    const { f, ctx, draftId } = await setupNew();
    f.edits.listings.get.mockRejectedValueOnce(apiError(404));
    const res = await applyDraftHandler(ctx, { draftId, confirm: true, confirmPackageName: PKG });
    expect(res.isError).toBeUndefined();
    expect(f.calls).toEqual(["insert", "list", "update", "validate", "commit"]);
    expect(f.edits.listings.get).toHaveBeenCalledTimes(2);
    expect(f.edits.listings.update).toHaveBeenCalledWith({
      packageName: PKG,
      editId: "edit-1",
      language: "pt-BR",
      requestBody: { title: "Título", shortDescription: "Curta", fullDescription: "Descrição" },
    });
    expect(f.edits.listings.patch).not.toHaveBeenCalled();
    expect(await ctx.store.isApplied(draftId)).toBe(true);
  });

  it("does not overwrite a listing created since the draft", async () => {
    const { f, ctx, draftId } = await setupNew();
    const res = await applyDraftHandler(ctx, { draftId, confirm: true, confirmPackageName: PKG });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("finnes allerede");
    expect(f.calls).toEqual(["insert", "list", "get", "delete"]);
    expect(f.edits.listings.update).not.toHaveBeenCalled();
    expect((await ctx.store.list()).drafts).toHaveLength(1);
  });

  it("requires confirmation and a matching package before creating a listing", async () => {
    const { f, ctx, draftId } = await setupNew();
    const noConfirm = await applyDraftHandler(ctx, { draftId, confirm: false, confirmPackageName: PKG });
    const wrongPackage = await applyDraftHandler(ctx, {
      draftId,
      confirm: true,
      confirmPackageName: "no.example.app2",
    });
    expect(noConfirm.isError).toBe(true);
    expect(wrongPackage.isError).toBe(true);
    expect(f.calls).toEqual([]);
  });

  it("revalidates required fields in a new-listing draft before contacting Play", async () => {
    const { f, ctx, draftId } = await setupNew();
    const { draft, file } = await ctx.store.read(draftId);
    await writeFile(file, JSON.stringify({ ...draft, proposed: { title: "Título" } }));
    const res = await applyDraftHandler(ctx, { draftId, confirm: true, confirmPackageName: PKG });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("shortDescription, fullDescription");
    expect(f.calls).toEqual([]);
  });

  it.each(["update", "validate", "commit"] as const)("cleans up a new-listing edit if %s fails", async (failing) => {
    const { f, ctx, draftId } = await setupNew();
    f.edits.listings.get.mockRejectedValueOnce(apiError(404));
    if (failing === "update") f.edits.listings.update.mockRejectedValueOnce(apiError(400));
    else f.edits[failing].mockRejectedValueOnce(apiError(400));
    const res = await applyDraftHandler(ctx, { draftId, confirm: true, confirmPackageName: PKG });
    expect(res.isError).toBe(true);
    expect(f.calls.at(-1)).toBe("delete");
    expect((await ctx.store.list()).drafts).toHaveLength(1);
  });

  it("does not publish a new listing when its lookup fails with a non-404 error", async () => {
    const { f, ctx, draftId } = await setupNew();
    f.edits.listings.get.mockRejectedValueOnce(apiError(403));
    const res = await applyDraftHandler(ctx, { draftId, confirm: true, confirmPackageName: PKG });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("Manage store presence");
    expect(f.edits.listings.update).not.toHaveBeenCalled();
    expect(f.calls.at(-1)).toBe("delete");
  });

  it("requires confirm=true", async () => {
    const { f, ctx, draftId } = await setup();
    const res = await applyDraftHandler(ctx, { draftId, confirm: false, confirmPackageName: PKG });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("confirm");
    expect(f.calls).toEqual([]);
  });

  it("requires a matching confirmPackageName", async () => {
    const { f, ctx, draftId } = await setup();
    const res = await applyDraftHandler(ctx, { draftId, confirm: true, confirmPackageName: "no.example.app2" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("confirmPackageName");
    expect(f.calls).toEqual([]);
  });

  it("aborts without writing when base_hash does not match live text", async () => {
    const { f, ctx, draftId } = await setup();
    f.listing.title = "Endret av noen andre";
    const res = await applyDraftHandler(ctx, { draftId, confirm: true, confirmPackageName: PKG });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("base_hash");
    expect(f.edits.listings.patch).not.toHaveBeenCalled();
    expect(f.edits.commit).not.toHaveBeenCalled();
    expect(f.calls).toEqual(["insert", "get", "delete"]);
    expect((await ctx.store.list()).drafts).toHaveLength(1);
  });

  it("deletes the edit and keeps the draft when the API fails", async () => {
    for (const failing of ["patch", "validate", "commit"] as const) {
      const { f, ctx, draftId } = await setup();
      if (failing === "patch") f.edits.listings.patch.mockRejectedValueOnce(apiError(400));
      else f.edits[failing].mockRejectedValueOnce(apiError(400));
      const res = await applyDraftHandler(ctx, { draftId, confirm: true, confirmPackageName: PKG });
      expect(res.isError).toBe(true);
      expect(f.calls.at(-1)).toBe("delete");
      expect((await ctx.store.list()).drafts).toHaveLength(1);
    }
  });

  it("patches only changed fields, commits, archives, and refuses a second apply", async () => {
    const { f, ctx, draftId } = await setup();
    const res = await applyDraftHandler(ctx, { draftId, confirm: true, confirmPackageName: PKG });
    expect(res.isError).toBeUndefined();
    expect(dataOf(res).status).toBe("published");
    expect(f.edits.listings.patch).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { title: "Ny tittel", shortDescription: "Ny kort" }, language: "nb-NO" }),
    );
    expect(f.calls).toEqual(["insert", "get", "delete", "insert", "patch", "validate", "commit"]);
    expect((await ctx.store.list()).drafts).toHaveLength(0);

    const again = await applyDraftHandler(ctx, { draftId, confirm: true, confirmPackageName: PKG });
    expect(again.isError).toBe(true);
    expect(textOf(again)).toContain("allerede publisert");
  });

  it("rejects drafts whose package is no longer in the allowlist", async () => {
    const { f, ctx, draftId } = await setup();
    ctx.config.allowedPackages = ["no.example.app2"];
    const res = await applyDraftHandler(ctx, { draftId, confirm: true, confirmPackageName: PKG });
    expect(res.isError).toBe(true);
    expect(f.calls).toEqual([]);
  });
});
