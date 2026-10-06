import { describe, it, expect } from "vitest";
import { emailSchema, phoneSchema } from "../../../shared/contracts/common.ts";

describe("a contact's email and phone", () => {
  it("keeps the numbers people have, and refuses text with no number", () => {
    for (const phone of [
      "+1 415 555 0100",
      "tel:+1-415-555-0100", // a vCard 4 link
      "415–555–0100", // en dashes
      "‪+1 415 555 0100‬", // a phone's copy marks
      "０９０-１２３４-５６７８", // full-width digits
    ]) {
      expect(phoneSchema.safeParse(phone).success, phone).toBe(true);
    }
    expect(phoneSchema.safeParse("n/a").success).toBe(false);
    expect(phoneSchema.safeParse("12").success).toBe(false);
  });

  it("answers at once for a long run of dots", () => {
    // `[^\s@]+\.[^\s@]+` backtracked: this took minutes, in one request.
    const started = performance.now();
    const long = `rowan@${"a.".repeat(200_000)} x`;
    expect(emailSchema.safeParse(long).success).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(emailSchema.safeParse("rowan@example.com").success).toBe(true);
  });
});
