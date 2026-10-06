// int8 search vectors. `search_embeddings` stores each component as one signed
// byte, a quarter of a float's space: round(component × scale), clamped to ±90,
// with one scale for the whole table. The query uses the same scale, so every
// L2 distance is the float distance times the scale, up to rounding, and the
// order of the neighbors is kept. One scale per table, not per vector, because
// an L2 distance subtracts components of two vectors, which must share a unit.
// The scale is 90 over the largest component the table held when it was set,
// stored in `app_settings` as `search.vectorScale`.
//
// Why 90 and not 127: sqlite-vec 0.1.9 squares each byte difference in 16 bits
// on its NEON path, 16 components at a time, and a difference of 182 or more
// overflows, giving NULL or a wrong distance. At ±127 two large components of
// opposite sign reach it (on the search gate's vectors recall@10 against float
// fell from 0.984 to 0.967). At ±90 no difference passes 180, and recall@10 is
// 0.984.
//
// The scale is set once: by the boot migration from the float vectors, or by
// the first write to an empty table from that write's vectors. A later vector
// with a larger component is clamped; on the search gate's 370 MiniLM vectors,
// a scale from the first 64 clips 9 of 142,080 components. A new embedding
// model rebuilds the table, and its first write sets a new scale.
//
// `contact_embeddings`, the dedupe store, stays float: its similarity scores
// are thresholds, not only an order. No imports: `server/db.ts` runs the
// migration with these at boot.

/** The `app_settings` key that holds the scale, a JSON number. */
export const VECTOR_SCALE_KEY = "search.vectorScale";

/**
 * The largest byte a component becomes. Two components differ by at most
 * 180, which sqlite-vec's 16-bit square holds (see above).
 */
export const MAX_BYTE = 90;

/**
 * The scale for components in [-1, 1], used when there is nothing to learn a
 * scale from: a table whose only vectors are zero, which are zero at any scale.
 */
export const UNIT_SCALE = MAX_BYTE;

/**
 * 90 over the largest absolute component of `vectors`, or null when there
 * is no component that is not zero.
 */
export function scaleFor(vectors: Iterable<ArrayLike<number>>): number | null {
  let largest = 0;
  for (const vector of vectors)
    for (let i = 0; i < vector.length; i++) {
      const size = Math.abs(vector[i]);
      if (size > largest) largest = size;
    }
  return largest > 0 && Number.isFinite(largest) ? MAX_BYTE / largest : null;
}

/** One vector as bytes at `scale`, ready to bind as `vec_int8(?)`. */
export function quantize(vector: ArrayLike<number>, scale: number): Buffer {
  const bytes = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    const value = Math.round(vector[i] * scale);
    bytes[i] =
      value > MAX_BYTE ? MAX_BYTE : value < -MAX_BYTE ? -MAX_BYTE : value;
  }
  return Buffer.from(bytes.buffer);
}

/** A float32 vector stored as a blob, read back as numbers. */
export function floatsOf(blob: Uint8Array): Float32Array {
  return new Float32Array(
    blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength),
  );
}
