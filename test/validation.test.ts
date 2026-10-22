import { describe, expect, it } from "vitest";
import { buildDiff, hashListing } from "../src/drafts/diff.js";
import { assertLanguage, assertPackageName, countChars, validateProposal } from "../src/validation.js";

describe("countChars", () => {
  it("counts code points, not UTF-16 units or bytes", () => {
    expect(countChars("abc")).toBe(3);
    expect(countChars("æøå")).toBe(3);
    expect(countChars("😀")).toBe(1);
    expect("😀".length).toBe(2);
    expect(countChars("a😀b🎉")).toBe(4);
  });
});

describe("validateProposal", () => {
  it("accepts texts exactly at the limit, including astral characters", () => {
    expect(validateProposal({ title: "😀".repeat(30) })).toEqual([]);
    expect(validateProposal({ shortDescription: "a".repeat(80) })).toEqual([]);
    expect(validateProposal({ fullDescription: "a".repeat(4000) })).toEqual([]);
  });

  it("reports field and overflow", () => {
    expect(validateProposal({ title: "😀".repeat(35) })).toEqual(["title: 35 tegn, 5 over grensen på 30."]);
    expect(validateProposal({ shortDescription: "a".repeat(81) })[0]).toMatch(/shortDescription.*1 over/);
    expect(validateProposal({ fullDescription: "a".repeat(4002) })[0]).toMatch(/fullDescription.*2 over/);
  });

  it("requires at least one field and rejects empty text fields", () => {
    expect(validateProposal({})[0]).toMatch(/Minst ett/);
    expect(validateProposal({ title: "  " })[0]).toMatch(/title/);
  });

  it("allows an empty video to remove it, but rejects non-URLs", () => {
    expect(validateProposal({ video: "" })).toEqual([]);
    expect(validateProposal({ video: "https://youtu.be/abc" })).toEqual([]);
    expect(validateProposal({ video: "javascript:alert(1)" })).toHaveLength(1);
    expect(validateProposal({ video: "not a url" })).toHaveLength(1);
  });
});

describe("identifier validation", () => {
  it("accepts valid package names and languages", () => {
    expect(assertPackageName("no.example.app1")).toBe("no.example.app1");
    expect(assertLanguage("nb-NO")).toBe("nb-NO");
    expect(assertLanguage("es-419")).toBe("es-419");
    expect(assertLanguage("fil")).toBe("fil");
  });

  it("rejects traversal and malformed values", () => {
    for (const bad of ["..", "../x", "a/b.c", "a.b/../c", "single", "no.example.app 1", ""]) {
      expect(() => assertPackageName(bad)).toThrow();
    }
    for (const bad of ["..", "nb_NO", "nb/NO", "../nb", "", "NB-no", "nb-"]) {
      expect(() => assertLanguage(bad)).toThrow();
    }
  });
});

describe("hashListing and buildDiff", () => {
  const base = { title: "A", shortDescription: "B", fullDescription: "C", video: "" };

  it("is stable, NFC-normalized and treats missing as empty", () => {
    expect(hashListing(base)).toBe(hashListing({ ...base }));
    expect(hashListing({ title: "e\u0301" })).toBe(hashListing({ title: "\u00e9" }));
    expect(hashListing({ title: "A", shortDescription: "B", fullDescription: "C" })).toBe(hashListing(base));
    expect(hashListing({ ...base, title: "X" })).not.toBe(hashListing(base));
  });

  it("produces per-field diffs with lengths", () => {
    const diff = buildDiff(base, { title: "Ny 😀", shortDescription: "B" });
    expect(diff).toHaveLength(2);
    expect(diff[0]).toMatchObject({ field: "title", changed: true, beforeLength: 1, afterLength: 4 });
    expect(diff[0]?.summary).toBe("title: 1 → 4 tegn");
    expect(diff[1]).toMatchObject({ field: "shortDescription", changed: false });
  });
});
