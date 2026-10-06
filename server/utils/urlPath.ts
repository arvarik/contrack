/**
 * The path without its trailing slashes: `/api/mcp//` is `/api/mcp`. A loop,
 * not `replace(/\/+$/, "")`, whose backtracking makes a path of 16,000 slashes
 * and a letter cost 0.1 s on a request that needs no sign-in. This is linear.
 */
export function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end -= 1;
  return path.slice(0, end);
}
