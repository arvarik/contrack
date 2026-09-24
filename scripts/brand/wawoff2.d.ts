/** `wawoff2` ships no types. These are the calls the brand build makes. */
declare module "wawoff2" {
  /** A WOFF2 font's bytes to the TrueType or OpenType font inside it. */
  export function decompress(woff2: Uint8Array): Promise<Uint8Array>;
  /** A TrueType or OpenType font to WOFF2. */
  export function compress(font: Uint8Array): Promise<Uint8Array>;
  const wawoff2: { decompress: typeof decompress; compress: typeof compress };
  export default wawoff2;
}
