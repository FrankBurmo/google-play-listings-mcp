import type { Logger } from "../logger.js";
import { FIELDS, UserError, type ListingFields, type Proposal } from "../validation.js";

interface RawListing {
  language?: string | null;
  title?: string | null;
  shortDescription?: string | null;
  fullDescription?: string | null;
  video?: string | null;
}

/** Minimal structural subset of androidpublisher v3 used by this server. */
export interface PublisherLike {
  edits: {
    insert(p: { packageName: string }): Promise<{ data: { id?: string | null } }>;
    delete(p: { packageName: string; editId: string }): Promise<unknown>;
    validate(p: { packageName: string; editId: string }): Promise<unknown>;
    commit(p: { packageName: string; editId: string }): Promise<{ data: unknown }>;
    listings: {
      list(p: { packageName: string; editId: string }): Promise<{ data: { listings?: RawListing[] | null } }>;
      get(p: { packageName: string; editId: string; language: string }): Promise<{ data: RawListing }>;
      patch(p: {
        packageName: string;
        editId: string;
        language: string;
        requestBody: Proposal;
      }): Promise<{ data: unknown }>;
    };
  };
}

export interface Listing extends ListingFields {
  language: string;
}

function normalize(raw: RawListing, fallbackLanguage = ""): Listing {
  return {
    language: raw.language ?? fallbackLanguage,
    title: raw.title ?? "",
    shortDescription: raw.shortDescription ?? "",
    fullDescription: raw.fullDescription ?? "",
    video: raw.video ?? "",
  };
}

function statusOf(err: unknown): number | undefined {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  const candidates = [e?.response?.status, e?.status, e?.code];
  for (const c of candidates) {
    if (typeof c === "number") return c;
    if (typeof c === "string" && /^\d{3}$/.test(c)) return Number(c);
  }
  return undefined;
}

/** Maps Google API errors to messages that never include credentials or request headers. */
export function toUserError(err: unknown, what: string): UserError {
  if (err instanceof UserError) return err;
  const status = statusOf(err);
  switch (status) {
    case 401:
      return new UserError(`${what}: autentisering feilet. Sjekk tjenestekontoens nøkkel.`);
    case 403:
      return new UserError(
        `${what}: ingen tilgang (403). Sjekk at tjenestekontoen har «Manage store presence» for appen i Play Console, og at Android Publisher API er aktivert.`,
      );
    case 404:
      return new UserError(`${what}: ikke funnet (404). Sjekk pakkenavn og språk, og at appen har en oppføring.`);
    default: {
      const message = err instanceof Error ? err.message.slice(0, 300) : "ukjent feil";
      return new UserError(`${what}: Google Play API-feil${status ? ` (${status})` : ""}: ${message}`);
    }
  }
}

/** Opens an edit, runs fn, and always attempts to delete the edit afterwards (best effort). */
export async function withReadEdit<T>(
  api: PublisherLike,
  packageName: string,
  logger: Logger,
  fn: (editId: string) => Promise<T>,
): Promise<T> {
  const inserted = await api.edits.insert({ packageName });
  const editId = inserted.data.id;
  if (!editId) throw new Error("Play API returnerte ingen edit-id.");
  try {
    return await fn(editId);
  } finally {
    await deleteEditQuietly(api, packageName, editId, logger);
  }
}

async function deleteEditQuietly(api: PublisherLike, packageName: string, editId: string, logger: Logger) {
  try {
    await api.edits.delete({ packageName, editId });
  } catch (err) {
    logger.warn(`Kunne ikke slette edit ${editId} for ${packageName}: status ${statusOf(err) ?? "ukjent"}`);
  }
}

export async function listListings(api: PublisherLike, packageName: string, logger: Logger): Promise<Listing[]> {
  try {
    return await withReadEdit(api, packageName, logger, async (editId) => {
      const res = await api.edits.listings.list({ packageName, editId });
      return (res.data.listings ?? []).map((l) => normalize(l));
    });
  } catch (err) {
    throw toUserError(err, "Henting av oppføringer");
  }
}

export async function getListing(
  api: PublisherLike,
  packageName: string,
  language: string,
  logger: Logger,
): Promise<Listing> {
  try {
    return await withReadEdit(api, packageName, logger, async (editId) => {
      const res = await api.edits.listings.get({ packageName, editId, language });
      return normalize(res.data, language);
    });
  } catch (err) {
    throw toUserError(err, "Henting av oppføring");
  }
}

/** insert → patch → validate → commit. Deletes the edit if anything fails before commit. */
export async function patchListing(
  api: PublisherLike,
  packageName: string,
  language: string,
  patch: Proposal,
  logger: Logger,
): Promise<unknown> {
  const requestBody: Proposal = {};
  for (const f of FIELDS) {
    const v = patch[f];
    if (v !== undefined) requestBody[f] = v;
  }
  let editId: string | undefined;
  try {
    const inserted = await api.edits.insert({ packageName });
    editId = inserted.data.id ?? undefined;
    if (!editId) throw new Error("Play API returnerte ingen edit-id.");
    await api.edits.listings.patch({ packageName, editId, language, requestBody });
    await api.edits.validate({ packageName, editId });
    const committed = await api.edits.commit({ packageName, editId });
    return committed.data;
  } catch (err) {
    if (editId) await deleteEditQuietly(api, packageName, editId, logger);
    throw toUserError(err, "Publisering");
  }
}
