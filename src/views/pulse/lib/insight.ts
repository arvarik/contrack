/**
 * The model's Title Case category in the app's sentence case. A later word
 * keeps its spelling only when it has a capital after its first letter
 * ("AI", "LinkedIn"). Each part of a hyphenated word counts as a word, so
 * "AI-Powered" reads "AI-powered".
 */
export function sentenceCase(text: string): string {
  const part = (piece: string, first: boolean) => {
    if (first) return piece.charAt(0).toUpperCase() + piece.slice(1);
    return /[A-Z]/.test(piece.slice(1)) ? piece : piece.toLowerCase();
  };
  return text
    .trim()
    .split(/\s+/)
    .map((word, i) =>
      word
        .split("-")
        .map((piece, j) => part(piece, i === 0 && j === 0))
        .join("-"),
    )
    .join(" ");
}
