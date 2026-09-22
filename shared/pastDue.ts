/**
 * How far past its cadence a tracked contact is, in words.
 *
 * "1 day past due", "12 days past due", "3 weeks past due", "2 months past
 * due". Days up to two weeks, then weeks up to two months, then months. The
 * row on the Tracked contacts page, the Catch up group on Pulse and the
 * palette's zero state all say it, so a person reads one scale everywhere.
 *
 * This file imports nothing, so the server and the client both read it.
 *
 * @module shared/pastDue
 */
export function describePastDue(overshootDays: number): string {
  const days = Math.max(1, Math.round(overshootDays));
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} past due`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} past due`;
  }
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} past due`;
}
