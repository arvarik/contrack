/**
 * Why a person is in the Ask results: the profile fields that answer the
 * question, found with no model call, with the question's words marked. So
 * a card can say "Interests: Machine Learning" for one person and "Role:
 * Machine Learning Engineer" for another.
 */

/** A contact field that can answer a question. */
export type MatchedField =
  | "role"
  | "headline"
  | "company"
  | "industry"
  | "location"
  | "interest"
  | "tag"
  | "about"
  | "preferences"
  | "experience"
  | "education"
  | "address"
  | "lastContact";

/**
 * What proved the field.
 *
 * - `filter`: a database filter checked it, from a facet or the plan.
 * - `ai`: the AI check cited it.
 * - `words`: the question's words are in it.
 * - `meaning`: it is close to the question in meaning, with no words in
 *   common. Only the passage search finds these.
 */
export type MatchedHow = "filter" | "ai" | "words" | "meaning";

export interface MatchedOn {
  field: MatchedField;
  /** The contact's own text for the field, cut to one line. */
  text: string;
  /** Where the question's words are in `text`, as [start, end) offsets. */
  marks: [number, number][];
  how: MatchedHow;
}

/** The label a card shows before each field. */
export const MATCHED_FIELD_LABEL: Record<MatchedField, string> = {
  role: "Role",
  headline: "Headline",
  company: "Company",
  industry: "Industry",
  location: "Location",
  interest: "Interests",
  tag: "Tags",
  about: "About",
  preferences: "Preferences",
  experience: "Experience",
  education: "Education",
  address: "Address",
  lastContact: "Last contact",
};
