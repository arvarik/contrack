// =============================================================================
// Union-Find (Disjoint Set Union)
// =============================================================================
// General-purpose data structure that groups elements into disjoint sets with
// near-constant-time operations via path compression + union-by-rank.
//
// Used by the dedupe engine to cluster transitively-connected contacts:
//   If pair (A,B) and pair (B,C) are detected,
//   Union-Find groups them into a single cluster {A, B, C}.
//
// Time complexity: O(α(n)) per operation — effectively O(1).
// Space complexity: O(n) — one parent pointer per element.
// =============================================================================

export class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  /**
   * Find the root representative of the set containing `x`.
   * Uses path compression: every node touched during traversal is pointed
   * directly to the root, flattening the tree for future lookups.
   */
  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)!));
    }
    return this.parent.get(x)!;
  }

  /**
   * Merge the sets containing `a` and `b`.
   * Uses union-by-rank: the shorter tree is attached under the taller tree's
   * root, keeping the overall tree shallow.
   */
  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;

    const rankA = this.rank.get(rootA)!;
    const rankB = this.rank.get(rootB)!;

    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }
  }

  /** Check if `a` and `b` are in the same set. */
  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }

  /**
   * Return all clusters with 2+ members.
   * Singletons (elements that were never union'd) are excluded.
   */
  getClusters(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const x of this.parent.keys()) {
      const root = this.find(x);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(x);
    }

    // Only return multi-member clusters (singletons aren't duplicates)
    const clusters = new Map<string, string[]>();
    for (const [root, members] of groups) {
      if (members.length >= 2) {
        clusters.set(root, members);
      }
    }
    return clusters;
  }
}
