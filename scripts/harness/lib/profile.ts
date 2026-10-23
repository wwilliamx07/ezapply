/**
 * The obviously fake values the harness fills with: never the user's. `second` is the held-out path's set, different
 * from the first wherever a field takes free text.
 */
const FIRST = {
  "identity.firstName": "Jane",
  "identity.middleName": "Q",
  "identity.lastName": "Doe",
  "identity.preferredName": "Jane",
  "identity.fullName": "Jane Doe",
  "contact.email": "jane@example.com",
  "contact.phone.number": "5550100",
  "contact.address.line1": "1 Example Street",
  "contact.address.line2": "Unit 1",
  "contact.address.city": "Springfield",
  "contact.address.postalCode": "00000",
  "links.linkedin": "https://www.linkedin.com/in/jane-doe-example",
  "links.github": "https://github.com/jane-doe-example",
  "links.portfolio": "https://example.com",
  "work[].company": "Example Corp",
  "work[].title": "Engineer",
  "work[].location": "Springfield",
  "work[].highlights": "Placeholder text.",
  "education[].school": "Example University",
  "education[].field": "Placeholder Studies",
  "education[].gpa": "3.5",
};
const SECOND: typeof FIRST = {
  ...FIRST,
  "identity.firstName": "John",
  "identity.lastName": "Roe",
  "identity.preferredName": "John",
  "identity.fullName": "John Roe",
  "contact.email": "john@example.com",
  "contact.phone.number": "5550199",
  "contact.address.city": "Shelbyville",
};

export type ValueSet = "first" | "second";

/** A placeholder for a field that takes text: by its hint, else by what its prompt asks, else by its kind. */
export function placeholder(
  field: { kind: string; label: string; hint?: { profileKey: string } },
  set: ValueSet,
): string {
  const values = set === "first" ? FIRST : SECOND;
  const byHint = field.hint && (values as Record<string, string>)[field.hint.profileKey];
  if (byHint) return byHint;
  const label = field.label.toLowerCase();
  if (/e-?mail/.test(label)) return values["contact.email"];
  if (/phone|mobile/.test(label)) return values["contact.phone.number"];
  if (/linkedin/.test(label)) return values["links.linkedin"];
  if (/github/.test(label)) return values["links.github"];
  if (/url|website|portfolio|link/.test(label)) return values["links.portfolio"];
  switch (field.kind) {
    case "number":
      return set === "first" ? "1" : "2";
    case "date":
      return set === "first" ? "01/15/2020" : "06/30/2021";
    case "textarea":
      return set === "first" ? "Placeholder answer." : "Another placeholder answer.";
    default:
      return set === "first" ? "Test" : "Sample";
  }
}

/** A one-page placeholder PDF, for sites that keep an attached file until Submit. */
export const PLACEHOLDER_PDF = {
  name: "placeholder-resume.pdf",
  mimeType: "application/pdf",
  base64: Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  ).toString("base64"),
};
