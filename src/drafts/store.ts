import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { z } from "zod";
import {
  assertDraftId,
  assertLanguage,
  assertPackageName,
  LANGUAGE_RE,
  PACKAGE_RE,
  UserError,
  UUID_RE,
  type ListingFields,
  type Proposal,
} from "../validation.js";
import { buildDiff, hashListing } from "./diff.js";

const MAX_TEXT = 10_000;

const ProposalSchema = z
  .object({
    title: z.string().max(MAX_TEXT).optional(),
    shortDescription: z.string().max(MAX_TEXT).optional(),
    fullDescription: z.string().max(MAX_TEXT).optional(),
    video: z.string().max(MAX_TEXT).optional(),
  })
  .strict();

const BaseSchema = z.object({
  title: z.string().max(MAX_TEXT),
  shortDescription: z.string().max(MAX_TEXT),
  fullDescription: z.string().max(MAX_TEXT),
  video: z.string().max(MAX_TEXT),
});

export const DraftSchema = z.object({
  draftId: z.string().regex(UUID_RE),
  packageName: z.string().regex(PACKAGE_RE),
  language: z.string().regex(LANGUAGE_RE),
  base: BaseSchema.nullable(),
  base_hash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  proposed: ProposalSchema,
  createdAt: z.iso.datetime(),
}).refine((draft) => (draft.base === null) === (draft.base_hash === null));

export type Draft = z.infer<typeof DraftSchema>;

export interface DraftSummary {
  draftId: string;
  packageName: string;
  language: string;
  createdAt: string;
  changedFields: string[];
}

export interface DraftFilter {
  packageName?: string;
  language?: string;
}

const APPLIED_DIR = "applied";

export class DraftStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private safeJoin(...parts: string[]): string {
    const full = resolve(join(this.root, ...parts));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new UserError("Ugyldig sti for utkast.");
    }
    return full;
  }

  async create(input: {
    packageName: string;
    language: string;
    base: ListingFields | null;
    proposed: Proposal;
  }): Promise<{ draft: Draft; file: string }> {
    assertPackageName(input.packageName);
    assertLanguage(input.language);
    const draftId = randomUUID();
    const createdAt = new Date().toISOString();
    const draft: Draft = DraftSchema.parse({
      draftId,
      packageName: input.packageName,
      language: input.language,
      base: input.base,
      base_hash: input.base === null ? null : hashListing(input.base),
      proposed: input.proposed,
      createdAt,
    });
    const stamp = createdAt.replace(/[-:.]/g, "");
    const dir = this.safeJoin(input.packageName, input.language);
    await mkdir(dir, { recursive: true });
    const file = this.safeJoin(input.packageName, input.language, `${stamp}-${draftId}.json`);
    await writeFile(file, JSON.stringify(draft, null, 2), { encoding: "utf8", flag: "wx" });
    return { draft, file };
  }

  private async dirs(path: string): Promise<string[]> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  private async files(path: string): Promise<string[]> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
    } catch {
      return [];
    }
  }

  private async parseFile(file: string): Promise<Draft | undefined> {
    try {
      const parsed = DraftSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private async locate(filter: DraftFilter = {}): Promise<{ file: string; pkg: string; lang: string; name: string }[]> {
    const found: { file: string; pkg: string; lang: string; name: string }[] = [];
    for (const pkg of await this.dirs(this.root)) {
      if (!PACKAGE_RE.test(pkg) || (filter.packageName && pkg !== filter.packageName)) continue;
      for (const lang of await this.dirs(this.safeJoin(pkg))) {
        if (!LANGUAGE_RE.test(lang) || (filter.language && lang !== filter.language)) continue;
        for (const name of await this.files(this.safeJoin(pkg, lang))) {
          found.push({ file: this.safeJoin(pkg, lang, name), pkg, lang, name });
        }
      }
    }
    return found;
  }

  async list(filter: DraftFilter = {}): Promise<{ drafts: DraftSummary[]; invalid: number }> {
    const drafts: DraftSummary[] = [];
    let invalid = 0;
    for (const item of await this.locate(filter)) {
      const draft = await this.parseFile(item.file);
      if (!draft || draft.packageName !== item.pkg || draft.language !== item.lang) {
        invalid++;
        continue;
      }
      drafts.push({
        draftId: draft.draftId,
        packageName: draft.packageName,
        language: draft.language,
        createdAt: draft.createdAt,
        changedFields: buildDiff(draft.base, draft.proposed).filter((d) => d.changed).map((d) => d.field),
      });
    }
    drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { drafts, invalid };
  }

  async isApplied(draftId: string): Promise<boolean> {
    assertDraftId(draftId);
    const names = await this.files(this.safeJoin(APPLIED_DIR));
    return names.some((n) => n.includes(`-${draftId}`));
  }

  /** Reads and fully re-validates a draft; drafts on disk are untrusted input. */
  async read(draftId: string): Promise<{ draft: Draft; file: string }> {
    assertDraftId(draftId);
    const match = (await this.locate()).find((i) => i.name.endsWith(`-${draftId}.json`));
    if (!match) {
      if (await this.isApplied(draftId)) {
        throw new UserError(`Utkastet ${draftId} er allerede publisert.`);
      }
      throw new UserError(`Fant ikke utkast ${draftId}.`);
    }
    const draft = await this.parseFile(match.file);
    if (!draft || draft.draftId !== draftId || draft.packageName !== match.pkg || draft.language !== match.lang) {
      throw new UserError(`Utkastet ${draftId} er ugyldig eller ødelagt.`);
    }
    if (draft.base !== null && hashListing(draft.base) !== draft.base_hash) {
      throw new UserError(`Utkastet ${draftId} er ugyldig: base_hash stemmer ikke med base.`);
    }
    return { draft, file: match.file };
  }

  /** Atomically moves the draft to applied/ and stores Play's response alongside it. */
  async markApplied(draft: Draft, file: string, playResponse: unknown): Promise<string> {
    await mkdir(this.safeJoin(APPLIED_DIR), { recursive: true });
    const appliedAt = new Date().toISOString();
    const target = this.safeJoin(APPLIED_DIR, `${appliedAt.replace(/[-:.]/g, "")}-${draft.draftId}.json`);
    await rename(file, target);
    await writeFile(target, JSON.stringify({ ...draft, appliedAt, playResponse }, null, 2), "utf8");
    return target;
  }
}
