export class UserError extends Error {
  override name = "UserError";
}

export const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
export const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const TEXT_FIELDS = ["title", "shortDescription", "fullDescription"] as const;
export const FIELDS = [...TEXT_FIELDS, "video"] as const;
export type FieldName = (typeof FIELDS)[number];

export const LIMITS: Record<(typeof TEXT_FIELDS)[number], number> = {
  title: 30,
  shortDescription: 80,
  fullDescription: 4000,
};

export type ListingFields = Record<FieldName, string>;
export type Proposal = Partial<ListingFields>;

/** Counts Unicode code points, not UTF-16 units or bytes. */
export function countChars(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

export function assertPackageName(value: string): string {
  if (!PACKAGE_RE.test(value) || value.length > 255) {
    throw new UserError(`Ugyldig pakkenavn: «${value.slice(0, 80)}».`);
  }
  return value;
}

export function assertLanguage(value: string): string {
  if (!LANGUAGE_RE.test(value)) {
    throw new UserError(`Ugyldig språkkode: «${value.slice(0, 40)}». Forventet BCP-47, f.eks. nb-NO.`);
  }
  return value;
}

export function assertDraftId(value: string): string {
  if (!UUID_RE.test(value)) {
    throw new UserError("Ugyldig draftId. Forventet en UUID.");
  }
  return value;
}

export function parseAllowedPackages(raw: string): string[] {
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const invalid = items.filter((s) => !PACKAGE_RE.test(s));
  if (invalid.length > 0) {
    throw new UserError(`Ugyldige pakkenavn i PLAY_ALLOWED_PACKAGES: ${invalid.join(", ")}`);
  }
  return [...new Set(items)];
}

function isValidVideo(value: string): boolean {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && value.length <= 2048;
  } catch {
    return false;
  }
}

/** Returns a list of human-readable problems; empty when the proposal is valid. */
export function validateProposal(proposal: Proposal): string[] {
  const problems: string[] = [];
  if (FIELDS.every((f) => proposal[f] === undefined)) {
    problems.push("Minst ett av feltene title, shortDescription, fullDescription eller video må oppgis.");
  }
  for (const field of TEXT_FIELDS) {
    const value = proposal[field];
    if (value === undefined) continue;
    if (value.trim() === "") {
      problems.push(`${field}: kan ikke være tomt.`);
      continue;
    }
    const length = countChars(value);
    const limit = LIMITS[field];
    if (length > limit) {
      problems.push(`${field}: ${length} tegn, ${length - limit} over grensen på ${limit}.`);
    }
  }
  if (proposal.video !== undefined && !isValidVideo(proposal.video)) {
    problems.push("video: må være tom (fjerner videoen) eller en gyldig http(s)-URL.");
  }
  return problems;
}

export function assertValidProposal(proposal: Proposal): void {
  const problems = validateProposal(proposal);
  if (problems.length > 0) {
    throw new UserError(`Forslaget er ugyldig:\n- ${problems.join("\n- ")}`);
  }
}
