// Union-find (disjoint sets) with path compression and union by rank, about
// O(1) per operation and O(n) space. The dedupe engine uses it to cluster
// contacts: pairs (A,B) and (B,C) make one cluster {A, B, C}.

export class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  /**
   * The root of the set holding `x`. Path compression points every node on the
   * way straight at the root.
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
   * Merge the sets holding `a` and `b`, the shorter tree under the taller one's
   * root (union by rank).
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

  /** Every cluster with 2 or more members; singletons are left out. */
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
