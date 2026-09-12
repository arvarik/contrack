// =============================================================================
// isSharedMailbox — the test that keeps an identity anchor honest
// =============================================================================
// The dedupe engine merges two contacts that share an email address without
// asking anybody. This function is the only thing standing between that rule
// and a team alias, so the cost of each kind of mistake is asymmetric and
// worth stating:
//
//   A false positive (calling a personal address shared) costs a real
//   duplicate its identity anchor. The pair drops to a name-and-company score
//   and reaches a person instead of merging. Recoverable.
//
//   A false negative (calling a shared address personal) merges two people.
//   One of them stops existing.
//
// So the negative cases below matter more than the positive ones, and the list
// the function reads is short on purpose.
// =============================================================================

import { describe, it, expect } from "vitest";
import { isSharedMailbox } from "../../server/utils/nlp/emails.ts";

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
