// Unit: isSharedMailbox.
// The dedupe engine merges two contacts that share an email without asking,
// and this function is what keeps a team alias out of that rule. The costs
// are asymmetric:
//
//   A false positive (a personal address called shared) drops a real
//   duplicate to a name-and-company score, so a person reviews it.
//   Recoverable.
//
//   A false negative (a shared address called personal) merges two people.
//   One of them stops existing.
//
// So the negative cases matter more, and the list the function reads is
// short on purpose.

import { describe, it, expect } from "vitest";
import { isSharedMailbox } from "../../../../server/utils/nlp/emails.ts";

describe("isSharedMailbox", () => {
  describe("says yes", () => {
    it.each([
      ["info@northwind.example", "the bare role word"],
      ["INFO@Northwind.Example", "any case"],
      ["  support@northwind.example  ", "surrounding space"],
      ["team.northwind@example.net", "a role word with the company after it"],
      ["sales-uk@northwind.example", "a hyphen as the separator"],
      ["accounts_payable@northwind.example", "an underscore"],
      ["billing+vat@northwind.example", "a plus tag"],
      ["haddad.family@example.net", "a household, whose name comes first"],
      ["the.household@example.net", "the other household word"],
      ["no-reply@northwind.example", "a run-together word split by a hyphen"],
      ["no_reply@northwind.example", "the same word split differently"],
      ["noreply@northwind.example", "and unsplit"],
    ])("%s — %s", (email) => {
      expect(isSharedMailbox(email)).toBe(true);
    });
  });

  describe("says no", () => {
    it.each([
      ["anton.kovacs@northwind.example", "an ordinary personal address"],
      ["mark.sales@northwind.example", "a surname that is also a role word"],
      ["rose.office@example.net", "another one, in second position"],
      ["bill@example.net", "a given name that is also a noun"],
      ["art@example.net", "and another"],
      ["guy.pearce@example.net", "and another"],
      ["teamsley@example.net", "a word that merely starts with one"],
      ["information@example.net", "a longer word that contains one"],
      ["infopreneur@example.net", "and another"],
    ])("%s — %s", (email) => {
      expect(isSharedMailbox(email)).toBe(false);
    });
  });

  describe("refuses to guess", () => {
    it.each([
      ["", "an empty string"],
      ["info", "no at sign"],
      ["@northwind.example", "no local part"],
      ["   @northwind.example", "a local part of only space"],
    ])("%s — %s", (email) => {
      expect(isSharedMailbox(email)).toBe(false);
    });

    it("reads the last at sign, so a quoted local part cannot hide one", () => {
      // Not a supported address shape, and the point is that it fails closed
      // rather than throwing.
      expect(isSharedMailbox("weird@thing@example.net")).toBe(false);
    });
  });

  it("treats the whole local part as one word when joined", () => {
    // `customerservice` is in the list and `customer.service` reaches it by
    // the joined-token test, not by the first-token one.
    expect(isSharedMailbox("customer.service@example.net")).toBe(true);
    expect(isSharedMailbox("customer@example.net")).toBe(false);
  });
});
