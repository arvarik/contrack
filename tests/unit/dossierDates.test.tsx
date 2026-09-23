// @vitest-environment jsdom
/**
 * The dates on a dossier's jobs and schools.
 *
 * A span with only its end printed the end alone, "Dec 2024", which reads
 * as the start. It says "Until Dec 2024" now. A start alone, a current job
 * and a full span keep their forms.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DossierTab } from "../../src/views/contact-detail/components/DossierTab";
import type {
  Contact,
  ContactEducation,
  ContactExperience,
} from "../../src/types";

afterEach(cleanup);

const month = (year: number, index: number) =>
  new Date(year, index).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });

const job = (
  id: string,
  dates: Pick<ContactExperience, "startDate" | "endDate" | "isCurrent">,
): ContactExperience => ({
  id,
  company: `Company ${id}`,
  role: `Role ${id}`,
  location: null,
  description: null,
  ...dates,
});

const school = (
  id: string,
  dates: Pick<ContactEducation, "startDate" | "endDate">,
): ContactEducation => ({
  id,
  school: `School ${id}`,
  degree: null,
  fieldOfStudy: null,
  description: null,
  ...dates,
});

function mount(contact: Partial<Contact>) {
  render(
    <MemoryRouter>
      <DossierTab contact={{ id: "c", name: "Test", ...contact } as Contact} />
    </MemoryRouter>,
  );
}

describe("a dossier's date spans", () => {
  it("says Until before an end with no start", () => {
    mount({
      experience: [
        job("a", { startDate: null, endDate: "2024-12", isCurrent: false }),
      ],
      education: [school("b", { startDate: null, endDate: "2019-06-01" })],
    });
    expect(screen.getByText(`Until ${month(2024, 11)}`)).toBeTruthy();
    expect(screen.getByText(`Until ${month(2019, 5)}`)).toBeTruthy();
  });

  it("keeps a full span, a start alone and a current job as they were", () => {
    mount({
      experience: [
        job("a", {
          startDate: "2020-01",
          endDate: "2024-12",
          isCurrent: false,
        }),
        job("b", { startDate: "2025-02", endDate: null, isCurrent: true }),
        job("c", { startDate: "2018-03", endDate: null, isCurrent: false }),
      ],
    });
    expect(
      screen.getByText(`${month(2020, 0)} – ${month(2024, 11)}`),
    ).toBeTruthy();
    expect(screen.getByText(`${month(2025, 1)} – Present`)).toBeTruthy();
    expect(screen.getByText(month(2018, 2))).toBeTruthy();
    expect(screen.queryByText(/^Until/)).toBeNull();
  });
});
