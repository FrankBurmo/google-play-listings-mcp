import { createHash } from "node:crypto";
import { countChars, FIELDS, type FieldName, type ListingFields, type Proposal } from "../validation.js";

/** SHA-256 over canonical JSON: fixed alphabetical keys, NFC-normalized text, missing values as "". */
export function hashListing(fields: Partial<ListingFields>): string {
  const canonical = {
    fullDescription: (fields.fullDescription ?? "").normalize("NFC"),
    shortDescription: (fields.shortDescription ?? "").normalize("NFC"),
    title: (fields.title ?? "").normalize("NFC"),
    video: (fields.video ?? "").normalize("NFC"),
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export interface FieldDiff {
  field: FieldName;
  changed: boolean;
  before: string;
  after: string;
  beforeLength: number;
  afterLength: number;
  summary: string;
}

export function buildDiff(base: ListingFields | null, proposed: Proposal): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of FIELDS) {
    const after = proposed[field];
    if (after === undefined) continue;
    const before = base?.[field] ?? "";
    const changed = before !== after;
    const beforeLength = countChars(before);
    const afterLength = countChars(after);
    diffs.push({
      field,
      changed,
      before,
      after,
      beforeLength,
      afterLength,
      summary: changed ? `${field}: ${beforeLength} → ${afterLength} tegn` : `${field}: uendret (${afterLength} tegn)`,
    });
  }
  return diffs;
}

export function changedFields(base: ListingFields, proposed: Proposal): FieldName[] {
  return buildDiff(base, proposed)
    .filter((d) => d.changed)
    .map((d) => d.field);
}
