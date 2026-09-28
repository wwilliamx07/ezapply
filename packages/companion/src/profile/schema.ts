import { z } from "zod";

/**
 * profile/profile.yaml: facts about the user. Everything application forms ask for that is not a
 * screening question lives here. Bump schemaVersion and add a migration on breaking change.
 */
const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "use YYYY-MM");
/**
 * A month, or a day when it's known: some forms want a full date (an expected graduation date as MM/DD/YYYY),
 * and a month alone made the agent guess the day.
 */
const MonthOrDay = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/, 'use "YYYY-MM" or "YYYY-MM-DD" (quoted)');
const Url = z.string().url();

export const Profile = z.object({
  schemaVersion: z.literal(1),
  identity: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    middleName: z.string().optional(),
    preferredName: z.string().optional(),
    pronouns: z.string().optional(),
  }),
  contact: z.object({
    email: z.string().email(),
    phone: z
      .object({
        countryCode: z.string().default("+1"),
        number: z.string().min(4),
        type: z.enum(["mobile", "home", "work"]).default("mobile"),
      })
      .optional(),
    address: z.object({
      line1: z.string().optional(),
      line2: z.string().optional(),
      city: z.string().min(1),
      region: z.string().optional().describe("State / province"),
      postalCode: z.string().optional(),
      country: z.string().min(1),
    }),
  }),
  links: z
    .object({
      linkedin: Url.optional(),
      github: Url.optional(),
      portfolio: Url.optional(),
      other: z.array(z.object({ label: z.string(), url: Url })).default([]),
    })
    .default({ other: [] }),
  workAuthorization: z
    .object({
      authorizedIn: z.array(z.string()).default([]).describe("Countries the user may work in without sponsorship"),
      requiresSponsorshipNow: z.boolean().optional(),
      requiresSponsorshipFuture: z.boolean().optional(),
      citizenship: z.array(z.string()).default([]),
      securityClearance: z.string().optional(),
    })
    .default({ authorizedIn: [], citizenship: [] }),
  jobPreferences: z
    .object({
      relocate: z.boolean().optional(),
      workMode: z.enum(["remote", "hybrid", "onsite", "any"]).optional(),
      desiredLocations: z.array(z.string()).default([]),
      earliestStart: z.string().optional().describe("Date or phrase, e.g. 2026-06 or 'two weeks notice'"),
      willingToTravelPercent: z.number().min(0).max(100).optional(),
    })
    .default({ desiredLocations: [] }),
  work: z
    .array(
      z.object({
        company: z.string().min(1),
        title: z.string().min(1),
        location: z.string().optional(),
        employmentType: z.enum(["full-time", "part-time", "internship", "contract", "freelance"]).optional(),
        start: YearMonth,
        end: YearMonth.nullable().describe("null = current role"),
        highlights: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        school: z.string().min(1),
        degree: z.string().min(1).describe("e.g. Bachelor of Science"),
        field: z.string().optional(),
        start: MonthOrDay.optional(),
        end: MonthOrDay.optional().describe("Graduation or expected graduation"),
        gpa: z.string().optional(),
        honors: z.array(z.string()).default([]),
        coursework: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  skills: z.array(z.object({ category: z.string(), items: z.array(z.string()) })).default([]),
  languages: z
    .array(
      z.object({
        language: z.string(),
        proficiency: z.enum(["native", "fluent", "professional", "conversational", "basic"]),
      }),
    )
    .default([]),
  certifications: z
    .array(
      z.object({ name: z.string(), issuer: z.string().optional(), date: YearMonth.optional(), url: Url.optional() }),
    )
    .default([]),
  /**
   * Voluntary self-identification. Only ever filled from here, verbatim; "decline" means choose the
   * form's decline-to-answer option. Missing = ask the user each time.
   */
  eeo: z
    .object({
      gender: z.string().optional(),
      race: z.string().optional(),
      hispanicOrLatino: z.string().optional(),
      veteranStatus: z.string().optional(),
      disability: z.string().optional(),
      sexualOrientation: z.string().optional(),
    })
    .default({}),
});
export type Profile = z.infer<typeof Profile>;

/** Fields almost every application needs; reported by workspace_check when missing. */
export function missingProfileFields(p: Profile): string[] {
  const missing: string[] = [];
  if (!p.contact.phone) missing.push("contact.phone");
  if (!p.contact.address.region) missing.push("contact.address.region");
  if (!p.contact.address.postalCode) missing.push("contact.address.postalCode");
  if (p.workAuthorization.authorizedIn.length === 0) missing.push("workAuthorization.authorizedIn");
  if (p.workAuthorization.requiresSponsorshipNow === undefined)
    missing.push("workAuthorization.requiresSponsorshipNow");
  if (p.workAuthorization.requiresSponsorshipFuture === undefined)
    missing.push("workAuthorization.requiresSponsorshipFuture");
  if (p.work.length === 0 && p.education.length === 0) missing.push("work or education");
  if (!p.links.linkedin) missing.push("links.linkedin (optional but commonly asked)");
  return missing;
}

/** profile/answers.yaml: the screening-question answer bank. */
const AnswerValue = z.union([
  z.string(),
  z.null(),
  z.object({ default: z.string().nullable(), byCompany: z.record(z.string(), z.string()).default({}) }),
]);

export const AnswerEntry = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/, "lowercase letters, digits and underscores"),
  canonical: z.string().min(5),
  /** null = always ask the user. */
  answer: AnswerValue,
  /** Proposed default shown during onboarding; never used on a form until confirmed into `answer`. */
  suggested: z.string().optional(),
  /** Where the answer should come from instead of a fixed value, e.g. "profile.workAuthorization". */
  source: z.string().optional(),
  sensitive: z.boolean().default(false),
  variants: z.array(z.string()).default([]),
  notes: z.string().optional(),
});
export type AnswerEntry = z.infer<typeof AnswerEntry>;

export const AnswersFile = z
  .object({
    schemaVersion: z.literal(1),
    /** Which version of ezapply's seed questions the file has had (1 when absent). See seed-answers.ts. */
    seedVersion: z.number().int().optional(),
    entries: z.array(AnswerEntry),
  })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    f.entries.forEach((e, i) => {
      if (seen.has(e.id)) ctx.addIssue({ code: "custom", message: `duplicate id ${e.id}`, path: ["entries", i, "id"] });
      seen.add(e.id);
    });
  });
export type AnswersFile = z.infer<typeof AnswersFile>;

/** profile/repos.yaml: which GitHub repos feed the knowledge base. */
export const ReposFile = z.object({
  schemaVersion: z.literal(1),
  repos: z
    .array(
      z.object({
        fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "owner/name"),
        /** "app" = via the GitHub App; "public-url" = added by URL, cloned anonymously. */
        source: z.enum(["app", "public-url"]).default("app"),
        note: z.string().optional(),
      }),
    )
    .default([]),
});
export type ReposFile = z.infer<typeof ReposFile>;
