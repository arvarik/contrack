/**
 * MatchedFields: why a person is in the Ask results, on their card.
 *
 * One line per field that answers the question, most telling first: the
 * field's name, then the contact's own text with the question's words
 * marked. "Interests: Machine Learning" and "Role: Machine Learning
 * Engineer" say at a glance that two people match the same question for
 * different reasons.
 *
 * The server finds these fields with no model call (`matchedOn.ts`). A field
 * the AI check cited carries the AI sparkle. A field close in meaning, with
 * none of the question's words, says so, so an unmarked line never reads as
 * a keyword match.
 *
 * The lines sit inside the card's button, so they are spans, and a screen
 * reader hears them as part of the card's name.
 *
 * @module views/search/MatchedFields
 */
import {
  Briefcase,
  Building,
  Clock,
  FileText,
  Globe,
  GraduationCap,
  Heart,
  History,
  Home,
  IdCard,
  MapPin,
  Sparkles,
  Tag,
  type LucideIcon,
} from "lucide-react";
import {
  MATCHED_FIELD_LABEL,
  type MatchedField,
  type MatchedOn,
} from "../../../shared/matchedOn";
import { Highlighted } from "../../components/ui/Highlighted";

/** The metadata row's icons where the field is the same. */
const FIELD_ICON: Record<MatchedField, LucideIcon> = {
  role: Briefcase,
  headline: IdCard,
  company: Building,
  industry: Globe,
  location: MapPin,
  interest: Heart,
  tag: Tag,
  about: FileText,
  preferences: FileText,
  experience: History,
  education: GraduationCap,
  address: Home,
  lastContact: Clock,
};

export const MatchedFields = ({ fields }: { fields: MatchedOn[] }) => (
  <span className="flex flex-col gap-1 mt-1" data-testid="matched-fields">
    {fields.map((entry) => {
      const Icon = FIELD_ICON[entry.field];
      return (
        <span
          key={entry.field}
          className="flex items-start gap-1.5 text-sm leading-snug min-w-0"
        >
          <Icon
            className="w-3.5 h-3.5 mt-0.5 shrink-0 text-on-surface-variant"
            aria-hidden="true"
          />
          <span className="min-w-0 line-clamp-2 text-on-surface">
            <span className="font-semibold text-on-surface-variant">
              {MATCHED_FIELD_LABEL[entry.field]}
              {entry.how === "meaning" && (
                <span className="font-normal italic"> (similar meaning)</span>
              )}
              :{" "}
            </span>
            <Highlighted text={entry.text} ranges={entry.marks} />
            {entry.how === "ai" && (
              <>
                <Sparkles
                  className="inline-block w-3 h-3 ml-1 -mt-0.5 text-ai"
                  aria-hidden="true"
                />
                <span className="sr-only"> (checked by AI)</span>
              </>
            )}
          </span>
        </span>
      );
    })}
  </span>
);
