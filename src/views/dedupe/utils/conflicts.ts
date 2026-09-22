import type { Contact } from "../../../types";

export interface FieldConflict {
  field: string;
  label: string;
  primaryValue: string;
  duplicateValue: string;
  duplicateName: string;
}

/**
 * Detects scalar and custom attribute fields where both primary and duplicate
 * have non-empty, conflicting values.
 *
 * During a merge, the primary contact's value is kept and the duplicate's
 * conflicting value is discarded.
 */
export function detectMergeConflicts(
  primary: Contact | null | undefined,
  duplicates: Contact[] | null | undefined,
): FieldConflict[] {
  if (!primary || !duplicates || duplicates.length === 0) return [];

  const fields: { key: keyof Contact; label: string }[] = [
    { key: "name", label: "Full name" },
    { key: "company", label: "Company" },
    { key: "role", label: "Role" },
    { key: "location", label: "Location" },
    { key: "headline", label: "Headline" },
    { key: "industry", label: "Industry" },
    { key: "website", label: "Website" },
    { key: "birthday", label: "Birthday" },
    { key: "about", label: "About" },
    { key: "pronouns", label: "Pronouns" },
  ];

  const conflicts: FieldConflict[] = [];

  for (const dup of duplicates) {
    if (!dup) continue;

    for (const { key, label } of fields) {
      const pVal = primary[key];
      const dVal = dup[key];
      if (
        typeof pVal === "string" &&
        pVal.trim() &&
        typeof dVal === "string" &&
        dVal.trim() &&
        pVal.trim().toLowerCase() !== dVal.trim().toLowerCase()
      ) {
        conflicts.push({
          field: String(key),
          label,
          primaryValue: pVal.trim(),
          duplicateValue: dVal.trim(),
          duplicateName: dup.name || "Duplicate",
        });
      }
    }

    // Custom attributes
    const primaryAttrMap = new Map(
      (primary.attributes ?? []).map((a) => [
        (a.name || "").toLowerCase().trim(),
        a.value || "",
      ]),
    );

    for (const dAttr of dup.attributes ?? []) {
      const attrNameKey = (dAttr.name || "").toLowerCase().trim();
      if (!attrNameKey) continue;
      const pVal = primaryAttrMap.get(attrNameKey);
      const dVal = (dAttr.value || "").trim();
      if (pVal && dVal && pVal.toLowerCase().trim() !== dVal.toLowerCase()) {
        conflicts.push({
          field: `attribute:${dAttr.name}`,
          label: `Attribute: ${dAttr.name}`,
          primaryValue: pVal.trim(),
          duplicateValue: dVal,
          duplicateName: dup.name || "Duplicate",
        });
      }
    }
  }

  return conflicts;
}
