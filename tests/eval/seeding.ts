// =============================================================================
// Seeding and vector reading shared by the eval harnesses
// =============================================================================
// The search, dedupe and answer harnesses all write a fixture corpus through
// the product's create path with ids that are the same on every run, and the
// search, answer and passage gates all read a flat file of recorded vectors.
// Each used to carry its own copy of both.
// =============================================================================

import crypto from "crypto";
import { contactService } from "../../server/services/contactService.ts";
import type { NewContactPayload } from "../../server/repositories/types.ts";
import type { Scope } from "../../server/tenancy/scope.ts";

/** Fixture key to database id, and database id to fixture key. */
export interface SeededIds {
  idByKey: Map<string, string>;
  keyById: Map<string, string>;
}

/**
 * Write fixture contacts into a real database under one owner, with ids that
 * are the same on every run.
 *
 * Through `bulkCreateContacts`, not through INSERT: the FTS rows, the child
 * rows, the source platform and the phonetic hash all come from the create
 * path, and a hand-written row would index and normalize differently from a
 * row the product writes.
 *
 * The ids must not change between runs because the product breaks ties on
 * them. `lexicalSearch` orders by `bm25(...), c.id`, so two contacts on one
 * BM25 score swap places, and at the tenth position that moves a contact in
 * and out of recall@10. The dedupe self-join emits `idA < idB`, so a random
 * id changes which record a failure message names. A gate that fails at
 * random teaches everybody to re-run it until it passes.
 *
 * Each id is a valid v4 UUID made from a hash of `salt` and a counter. The
 * service picks its own ids and takes no argument for one, which is correct
 * for the product. So the generator is replaced for the insert and put back
 * afterwards.
 */
export async function seedWithStableIds<T extends { key: string }>(
  scope: Scope,
  salt: string,
  contacts: T[],
  toPayload: (contact: T) => NewContactPayload,
): Promise<SeededIds> {
  const realRandomUUID = crypto.randomUUID;
  let issued = 0;
  (crypto as { randomUUID: () => string }).randomUUID = () => {
    const h = crypto
      .createHash("sha256")
      .update(`${salt}:${issued++}`)
      .digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };

  let createdIds: string[];
  try {
    ({ createdIds } = await contactService.bulkCreateContacts(
      scope,
      contacts.map(toPayload),
    ));
  } finally {
    (crypto as { randomUUID: typeof realRandomUUID }).randomUUID =
      realRandomUUID;
  }

  if (createdIds.length !== contacts.length) {
    throw new Error(
      `Seeded ${createdIds.length} of ${contacts.length} contacts. The eval cannot score a partial corpus.`,
    );
  }

  const idByKey = new Map<string, string>();
  const keyById = new Map<string, string>();
  contacts.forEach((c, i) => {
    idByKey.set(c.key, createdIds[i]);
    keyById.set(createdIds[i], c.key);
  });
  return { idByKey, keyById };
}

/**
 * Split a flat file of float32 vectors into one array per row.
 *
 * The copy through `slice` is not waste. `readFileSync` hands back a Buffer
 * that borrows a shared pool, and its `byteOffset` is whatever the pool
 * happened to be at, so a Float32Array view over it throws on any offset that
 * is not a multiple of four. The copy also detaches the vectors from the
 * pool, which is what lets the Buffer be collected.
 */
export function splitVectors(
  buf: Buffer,
  count: number,
  dimension: number,
  from = 0,
): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const start = (from + i) * dimension * 4;
    const end = start + dimension * 4;
    const bytes = buf.buffer.slice(
      buf.byteOffset + start,
      buf.byteOffset + end,
    );
    out.push(new Float32Array(bytes));
  }
  return out;
}
