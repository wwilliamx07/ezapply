import type { AnswerEntry } from "./schema.js";

type Seed = Omit<AnswerEntry, "variants" | "sensitive"> &
  Partial<Pick<AnswerEntry, "variants" | "sensitive">> & {
    /** The seed version that added the entry (1 when absent). */
    since?: number;
  };

/**
 * The seed's version, stored as `seedVersion` in answers.yaml. An existing answer bank gets the entries of
 * later versions once (ProfileService.ensureAnswerSeed), so questions the user deleted aren't added back.
 */
export const SEED_VERSION = 2;

/**
 * Screening questions that recur across Workday tenants. Every answer starts as null: onboarding
 * walks the user through them and the confirmed value replaces null. `suggested` is only a prompt.
 */
const SEED: Seed[] = [
  // Eligibility
  {
    id: "authorized_to_work",
    canonical: "Are you legally authorized to work in the country of this job?",
    answer: null,
    source: "profile.workAuthorization.authorizedIn",
    notes: "Compare the job's country with profile.workAuthorization.authorizedIn.",
  },
  {
    id: "sponsorship_now",
    canonical: "Do you now require visa sponsorship to work in the country of this job?",
    answer: null,
    source: "profile.workAuthorization.requiresSponsorshipNow",
  },
  {
    id: "sponsorship_future",
    canonical: "Will you in the future require visa sponsorship to work in the country of this job?",
    answer: null,
    source: "profile.workAuthorization.requiresSponsorshipFuture",
  },
  { id: "age_18_plus", canonical: "Are you at least 18 years of age?", answer: null, suggested: "Yes" },
  {
    id: "export_control_us_person",
    canonical: "Are you a U.S. person (citizen, permanent resident, refugee or asylee) for export-control purposes?",
    answer: null,
    source: "profile.workAuthorization.citizenship",
    sensitive: true,
  },
  {
    id: "security_clearance",
    canonical: "Do you currently hold an active security clearance?",
    answer: null,
    source: "profile.workAuthorization.securityClearance",
  },
  {
    id: "sanctioned_country_national",
    canonical: "Are you a citizen or resident of a country subject to comprehensive sanctions?",
    answer: null,
    sensitive: true,
  },

  // Relationship to the company
  {
    id: "previously_employed",
    canonical: "Have you previously been employed by this company?",
    answer: { default: null, byCompany: {} },
    suggested: "No",
    notes: "Add byCompany entries for any past employers.",
  },
  {
    id: "previously_contractor",
    canonical: "Have you previously worked for this company as a contractor, consultant or intern?",
    answer: { default: null, byCompany: {} },
    suggested: "No",
  },
  {
    id: "relatives_employed",
    canonical: "Do you have relatives currently employed by this company?",
    answer: null,
    suggested: "No",
  },
  {
    id: "referred_by_employee",
    canonical: "Were you referred by a current employee?",
    answer: { default: null, byCompany: {} },
    suggested: "No",
  },
  {
    id: "how_heard",
    canonical: "How did you hear about this position?",
    answer: null,
    suggested: "Company careers website",
    notes: "Pick the closest option on the form.",
  },

  // Government / conflicts
  {
    id: "gov_official_relationship",
    canonical: "Do you have a close personal relationship with a government official?",
    answer: null,
    suggested: "No",
    variants: ["Are you related to or closely associated with any government official or employee?"],
  },
  {
    id: "politically_exposed_person",
    canonical: "Are you a politically exposed person?",
    answer: null,
    suggested: "No",
  },
  {
    id: "gov_employee_recent",
    canonical: "Are you currently, or have you been in the last few years, employed by a government entity?",
    answer: null,
    suggested: "No",
  },
  {
    id: "gov_procurement_involvement",
    canonical: "As a government employee, were you involved in procurement or decisions involving this company?",
    answer: null,
    suggested: "No",
  },
  {
    id: "conflict_of_interest",
    canonical: "Do you have any business or financial interests that could conflict with this role?",
    answer: null,
    suggested: "No",
  },
  {
    id: "debarred_excluded",
    canonical: "Have you ever been debarred or excluded from government contracting or programs?",
    answer: null,
    suggested: "No",
  },
  {
    id: "non_compete",
    canonical:
      "Are you bound by a non-compete, non-solicitation or other agreement that would restrict you in this role?",
    answer: null,
    suggested: "No",
  },

  // Consents
  {
    id: "background_check_consent",
    canonical: "Are you willing to undergo a background check?",
    answer: null,
    suggested: "Yes",
  },
  {
    id: "drug_test_consent",
    canonical: "Are you willing to undergo a drug screening?",
    answer: null,
    suggested: "Yes",
  },
  {
    id: "text_message_consent",
    canonical: "Do you consent to receive text messages about your application?",
    answer: null,
    suggested: "No",
  },
  {
    id: "privacy_notice_ack",
    canonical: "Do you acknowledge you have read the candidate privacy notice?",
    answer: null,
    suggested: "Yes",
  },
  {
    id: "information_accurate_cert",
    canonical: "Do you certify that the information in your application is accurate and complete?",
    answer: null,
    suggested: "Yes",
  },

  // Logistics
  {
    id: "willing_to_relocate",
    canonical: "Are you willing to relocate for this position?",
    answer: null,
    source: "profile.jobPreferences.relocate",
  },
  {
    id: "able_to_work_onsite",
    canonical: "Are you able to work on-site or hybrid at this job's location?",
    answer: null,
    source: "profile.jobPreferences.workMode",
  },
  {
    id: "willing_to_travel",
    canonical: "Are you willing to travel for this role as required?",
    answer: null,
    source: "profile.jobPreferences.willingToTravelPercent",
  },
  {
    id: "overtime_weekends",
    canonical: "Are you available to work overtime, evenings or weekends when needed?",
    answer: null,
  },
  {
    id: "earliest_start",
    canonical: "When can you start?",
    answer: null,
    source: "profile.jobPreferences.earliestStart",
  },
  {
    id: "salary_expectation",
    canonical: "What are your salary expectations?",
    answer: null,
    sensitive: true,
    notes: "Always ask; answers depend on role and location.",
  },

  // Qualifications computed from the profile
  {
    id: "degree_completed",
    canonical: "Have you completed the degree required for this role?",
    answer: null,
    source: "profile.education",
    notes: "Compute from education end dates; answer per the degree the form names.",
  },
  { id: "english_fluent", canonical: "Are you fluent in English?", answer: null, source: "profile.languages" },

  // Sensitive history
  {
    id: "criminal_conviction",
    canonical: "Have you ever been convicted of a crime?",
    answer: null,
    sensitive: true,
    notes: "Always ask. Rules vary by jurisdiction.",
  },

  // Students and co-op (version 2): campus postings ask these, and a live run had to work them out or ask
  // mid-form (the agent guessed the year of study from an unrelated certificate date).
  {
    since: 2,
    id: "currently_enrolled",
    canonical: "Are you currently enrolled in a post-secondary program?",
    answer: null,
    source: "profile.education",
    notes: "Yes while an education entry's end is in the future.",
  },
  {
    since: 2,
    id: "year_of_study",
    canonical: "What year of study are you currently in?",
    answer: null,
    source: "profile.education",
    notes:
      "Compute from education[].start: first year until the next September, then one more each September. " +
      "Ask when start is missing; don't infer it from other dates.",
  },
  {
    since: 2,
    id: "expected_graduation",
    canonical: "What is your expected graduation date?",
    answer: null,
    source: "profile.education",
    notes: "education[].end. A form that wants a day needs end as YYYY-MM-DD: ask for the day rather than pick one.",
  },
  {
    since: 2,
    id: "available_work_terms",
    canonical: "Which work terms are you available for?",
    answer: null,
    notes: 'For example "Winter 2027 (January–April), Summer 2027". Update it each term.',
  },
  {
    since: 2,
    id: "returning_to_school",
    canonical: "Will you return to school after this work term?",
    answer: null,
    source: "profile.education",
  },
  {
    since: 2,
    id: "full_time_interest",
    canonical: "Are you interested in full-time opportunities after graduation?",
    answer: null,
    suggested: "Yes",
  },
];

/** The seed entries, or only those added after seed version `after`. */
export function seedAnswers(after = 0): AnswerEntry[] {
  return SEED.filter((s) => (s.since ?? 1) > after).map(({ since: _since, ...s }) => ({
    ...s,
    variants: s.variants ?? [],
    sensitive: s.sensitive ?? false,
  }));
}
