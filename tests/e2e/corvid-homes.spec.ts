/**
 * The corvid's other homes, in a real browser.
 *
 * The bird now stands where three spinners and a check mark used to, and on
 * a phone it has a perch of its own. Each of those is a place a person can
 * be while a screen reader is running, so each is scanned there.
 *
 * Two of the three AI pending states need the answer held open, because
 * neither is a frame between two renders on a fast machine: the synthesis
 * bar only starts after a click, and the briefing is written by a request a
 * blank instance answers at once. Both are held at the network edge, so
 * everything from the click to the last render is the real client code.
 *
 * The suite forces reduced motion, so none of these birds move. That is the
 * point of scanning them here: what is left when the motion is gone has to
 * be a picture with a name, or no picture at all, and never a control that
 * has quietly lost its label.
 */
import { devices, type Page } from "@playwright/test";
import { test, expect, gatedTest } from "./fixtures/test";
import { expectPageAccessible, expectVisibleFocus } from "./fixtures/a11y";
import { expectFloors } from "./fixtures/metrics";
import { answerPeopleSearch, personMatch } from "./fixtures/search";
import { ADMIN, completeSetup, signOutFromSidebar } from "./fixtures/accounts";

const { defaultBrowserType: _webkit, ...PHONE } = devices["Pixel 7"];

/**
 * The thinking bird. It is the glyph, and it is decoration at all three
 * call sites, because each of them already says what it is waiting for in
 * text beside it.
 */
const thinkingBird = (page: Page) =>
  page.locator('svg[data-variant="glyph"][aria-hidden="true"]');

test.describe("the bird while the AI works", () => {
  test("the briefing card thinks, and says so in words as well", async ({
    page,
    seed,
  }, testInfo) => {
    await page.route("**/api/contacts/*/briefing", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      await route.fulfill({ json: { points: ["one", "two", "three"] } });
    });

    await page.goto(`/contact/${seed.byName("Ada Lovelace").id}`);
    await page.getByRole("radio", { name: "Dossier" }).click();
    await page.getByRole("button", { name: "Generate briefing" }).click();

    // The sentence is the contract. The bird is a picture of the same thing
    // and says nothing of its own, so the status is announced once.
    await expect(page.getByText("Writing the briefing…")).toBeVisible();
    await expect(thinkingBird(page).first()).toBeVisible();

    await expectPageAccessible(page, testInfo, "briefing-pending");
  });

  test("Ask Contrack's synthesis bar thinks while it writes", async ({
    page,
    seed,
  }, testInfo) => {
    // The bar offers to summarise only once there are three results.
    await answerPeopleSearch(page, [
      personMatch(seed.byName("Ada Lovelace")),
      personMatch(seed.byName("Grace Hopper")),
      personMatch(seed.byName("Edsger Dijkstra")),
    ]);
    await page.route("**/api/search/synthesize", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: '{"phase":"complete","text":"A summary."}\n',
      });
    });

    await page.goto("/search");
    const input = page.getByRole("textbox", {
      name: "Ask anything about your network",
    });
    await input.fill("who works in maths");
    await input.press("Enter");

    // Synthesis is a second request, started by a click, so this state does
    // not exist until somebody asks for it.
    await page
      .getByRole("button", { name: /Synthesize these results/ })
      .click();
    await expect(page.getByText("Synthesizing…")).toBeVisible();
    await expect(thinkingBird(page).first()).toBeVisible();

    await expectPageAccessible(page, testInfo, "synthesis-pending");
  });
});

test.describe("the corvid's perch on a phone", () => {
  test.use({ ...PHONE, viewport: { width: 390, height: 844 } });

  test("Settings ends with a mark that flies, and the page holds its floors", async ({
    page,
  }, testInfo) => {
    await page.goto("/settings");
    await expect(
      page.getByText("Everything here is stored on this machine"),
    ).toBeVisible();

    const perch = page.getByRole("button", { name: "Contrack", exact: true });
    // Exactly one: the sidebar's perch is in the DOM below `md` but CSS
    // hides it, and a hidden button is not in the accessibility tree.
    await expect(perch).toHaveCount(1);
    await expect(perch).toBeVisible();
    await expect(perch).toHaveAttribute("title", "Let the corvid fly");
    await expect(perch.locator("svg")).toHaveAttribute("aria-hidden", "true");

    // It goes nowhere and it keeps focus, like the sidebar one.
    const before = page.url();
    await perch.focus();
    await expectVisibleFocus(perch);
    await page.keyboard.press("Enter");
    expect(page.url()).toBe(before);
    await expect(perch).toBeFocused();
    // Reduced motion is forced here, so no overlay is ever built.
    await expect(page.locator("[data-corvid-flight]")).toHaveCount(0);

    await expectFloors(page, testInfo, "settings-phone-perch");
    await expectPageAccessible(page, testInfo, "settings-phone-perch");
  });
});

gatedTest(
  "the sign-in card stays accessible after a wrong password",
  async ({ page }, testInfo) => {
    await page.goto("/");
    await completeSetup(page, ADMIN);
    await signOutFromSidebar(page, ADMIN);

    await page.getByLabel("Username or email").fill(ADMIN.email);
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    // The sentence the bird answers, and the only thing announced.
    await expect(page.getByRole("alert")).toHaveText(
      "Incorrect username or password.",
    );
    // The mark beside it is decoration, so the alert is the whole of what a
    // screen reader hears.
    const mark = page.getByTestId("auth-corvid").locator("svg");
    await expect(mark).toHaveAttribute("aria-hidden", "true");

    await expectPageAccessible(page, testInfo, "sign-in-wrong-password");
  },
);
