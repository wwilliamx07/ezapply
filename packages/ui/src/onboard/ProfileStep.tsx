import { type ReactNode, useMemo, useState } from "react";
import { Banner, Button, Icon } from "../components/ui.js";
import { ErrorNote, StepHead, TaskStatus, useBusy } from "./parts.js";
import { messageOf, useOnboard } from "./state.js";

/** The profile as the form holds it: plain data, the shape of profile.yaml. */
type Obj = Record<string, unknown>;

const EMPLOYMENT = ["", "full-time", "part-time", "internship", "contract", "freelance"];
const WORK_MODES = ["", "remote", "hybrid", "onsite", "any"];
const PROFICIENCY = ["native", "fluent", "professional", "conversational", "basic"];
const PHONE_TYPES = ["mobile", "home", "work"];

export function ProfileStep() {
  const { state, ask, act } = useOnboard();
  const busy = useBusy(["draft-profile"]);
  const [value, setValue] = useState<Obj>(() => structuredClone(state.profile.value ?? {}));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<{ path: string; message: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // A profile Claude just drafted replaces what the form holds, unless the user has started editing.
  const fromFile = JSON.stringify(state.profile.value ?? {});
  const [seen, setSeen] = useState(fromFile);
  if (fromFile !== seen && !dirty) {
    setSeen(fromFile);
    setValue(structuredClone(state.profile.value ?? {}));
  }
  const set = (path: (string | number)[], v: unknown) => {
    setValue((cur) => setIn(cur, path, v));
    setDirty(true);
    setSaved(false);
  };
  const get = (path: (string | number)[]) => getIn(value, path);
  const missing = new Set((state.profile.missing ?? []).map((m) => m.split(" ")[0] as string));
  const invalid = useMemo(
    () => new Map((errors ?? state.profile.errors ?? []).map((e) => [e.path, e.message])),
    [errors, state.profile.errors],
  );
  const done = state.steps.find((s) => s.id === "profile")?.done ?? false;
  const f = { get, set, missing, invalid };

  if (!state.profile.exists) {
    return (
      <>
        <StepHead title="Your profile" done={false}>
          Everything applications ask that isn't a screening question: your name, contact, work history, education.
          {state.agentName} drafts it from your resume, then you check it and fill in what a resume doesn't say.
        </StepHead>
        {!state.resume.main ? <p>Import your resume first (the step before this one).</p> : null}
        <div className="ob-actions">
          <Button
            variant="primary"
            disabled={busy || !state.resume.main}
            onClick={() => ask("draft-profile", { main: state.resume.main })}
          >
            Have {state.agentName} draft it from my resume
          </Button>
        </div>
        <TaskStatus kinds={["draft-profile"]} />
      </>
    );
  }

  return (
    <>
      <StepHead title="Your profile" done={done}>
        Check what {state.agentName} took from your resume and fill in the rest. Applications are filled from this, word
        for word.
      </StepHead>
      <TaskStatus kinds={["draft-profile"]} />
      {state.profile.missing?.length ? (
        <Banner tone="warn" icon={<Icon name="info" />}>
          Most applications ask for the fields marked below.
        </Banner>
      ) : null}

      <Section title="Name">
        <Grid>
          <Text f={f} path={["identity", "firstName"]} label="First name" required />
          <Text f={f} path={["identity", "lastName"]} label="Last name" required />
          <Text f={f} path={["identity", "middleName"]} label="Middle name" />
          <Text f={f} path={["identity", "preferredName"]} label="Preferred name" />
          <Text f={f} path={["identity", "pronouns"]} label="Pronouns" />
        </Grid>
      </Section>

      <Section title="Contact">
        <Grid>
          <Text f={f} path={["contact", "email"]} label="Email" type="email" required />
          <Text f={f} path={["contact", "phone", "countryCode"]} label="Country code" placeholder="+1" />
          <Text f={f} path={["contact", "phone", "number"]} label="Phone" type="tel" flag="contact.phone" />
          <Select f={f} path={["contact", "phone", "type"]} label="Phone type" options={PHONE_TYPES} />
        </Grid>
        <Grid>
          <Text f={f} path={["contact", "address", "line1"]} label="Address" />
          <Text f={f} path={["contact", "address", "line2"]} label="Address, line 2" />
          <Text f={f} path={["contact", "address", "city"]} label="City" required />
          <Text f={f} path={["contact", "address", "region"]} label="State or province" flag="contact.address.region" />
          <Text
            f={f}
            path={["contact", "address", "postalCode"]}
            label="Postal code"
            flag="contact.address.postalCode"
          />
          <Text f={f} path={["contact", "address", "country"]} label="Country" required />
        </Grid>
      </Section>

      <Section title="Links">
        <Grid>
          <Text f={f} path={["links", "linkedin"]} label="LinkedIn" type="url" flag="links.linkedin" />
          <Text f={f} path={["links", "github"]} label="GitHub" type="url" />
          <Text f={f} path={["links", "portfolio"]} label="Website or portfolio" type="url" />
        </Grid>
        <List
          f={f}
          path={["links", "other"]}
          noun="link"
          blank={{ label: "", url: "" }}
          render={(p) => (
            <Grid>
              <Text f={f} path={[...p, "label"]} label="Label" />
              <Text f={f} path={[...p, "url"]} label="Address" type="url" />
            </Grid>
          )}
        />
      </Section>

      <Section title="Work authorization">
        <Grid>
          <Words
            f={f}
            path={["workAuthorization", "authorizedIn"]}
            label="Countries you may work in without sponsorship"
            flag="workAuthorization.authorizedIn"
          />
          <YesNo
            f={f}
            path={["workAuthorization", "requiresSponsorshipNow"]}
            label="Need sponsorship now?"
            flag="workAuthorization.requiresSponsorshipNow"
          />
          <YesNo
            f={f}
            path={["workAuthorization", "requiresSponsorshipFuture"]}
            label="Need sponsorship in the future?"
            flag="workAuthorization.requiresSponsorshipFuture"
          />
          <Words f={f} path={["workAuthorization", "citizenship"]} label="Citizenship" />
          <Text f={f} path={["workAuthorization", "securityClearance"]} label="Security clearance" />
        </Grid>
      </Section>

      <Section title="What you're looking for">
        <Grid>
          <YesNo f={f} path={["jobPreferences", "relocate"]} label="Willing to relocate?" />
          <Select f={f} path={["jobPreferences", "workMode"]} label="Work mode" options={WORK_MODES} />
          <Words f={f} path={["jobPreferences", "desiredLocations"]} label="Where" />
          <Text
            f={f}
            path={["jobPreferences", "earliestStart"]}
            label="Earliest start"
            placeholder="2026-06, or two weeks' notice"
          />
          <Num f={f} path={["jobPreferences", "willingToTravelPercent"]} label="Travel, up to (%)" />
        </Grid>
      </Section>

      <Section title="Work history" flagged={missing.has("work")}>
        <List
          f={f}
          path={["work"]}
          noun="job"
          blank={{ company: "", title: "", start: "", end: null, highlights: [] }}
          render={(p) => (
            <>
              <Grid>
                <Text f={f} path={[...p, "company"]} label="Company" required />
                <Text f={f} path={[...p, "title"]} label="Title" required />
                <Text f={f} path={[...p, "location"]} label="Location" />
                <Select f={f} path={[...p, "employmentType"]} label="Type" options={EMPLOYMENT} />
                <Month f={f} path={[...p, "start"]} label="Started" required />
                <EndMonth f={f} path={[...p, "end"]} />
              </Grid>
              <Lines f={f} path={[...p, "highlights"]} label="Highlights, one per line" />
            </>
          )}
        />
      </Section>

      <Section title="Education">
        <List
          f={f}
          path={["education"]}
          noun="school"
          blank={{ school: "", degree: "", honors: [], coursework: [] }}
          render={(p) => (
            <Grid>
              <Text f={f} path={[...p, "school"]} label="School" required />
              <Text f={f} path={[...p, "degree"]} label="Degree" required placeholder="Bachelor of Science" />
              <Text f={f} path={[...p, "field"]} label="Field" />
              <Month f={f} path={[...p, "start"]} label="Started" />
              <Month f={f} path={[...p, "end"]} label="Graduated (or expected)" />
              <Text f={f} path={[...p, "gpa"]} label="GPA" />
              <Words f={f} path={[...p, "honors"]} label="Honors" />
              <Words f={f} path={[...p, "coursework"]} label="Coursework" />
            </Grid>
          )}
        />
      </Section>

      <Section title="Skills">
        <List
          f={f}
          path={["skills"]}
          noun="group"
          blank={{ category: "", items: [] }}
          render={(p) => (
            <Grid>
              <Text f={f} path={[...p, "category"]} label="Group" placeholder="Languages" />
              <Words f={f} path={[...p, "items"]} label="Skills" />
            </Grid>
          )}
        />
      </Section>

      <Section title="Languages">
        <List
          f={f}
          path={["languages"]}
          noun="language"
          blank={{ language: "", proficiency: "professional" }}
          render={(p) => (
            <Grid>
              <Text f={f} path={[...p, "language"]} label="Language" />
              <Select f={f} path={[...p, "proficiency"]} label="Level" options={PROFICIENCY} />
            </Grid>
          )}
        />
      </Section>

      <Section title="Certifications">
        <List
          f={f}
          path={["certifications"]}
          noun="certification"
          blank={{ name: "" }}
          render={(p) => (
            <Grid>
              <Text f={f} path={[...p, "name"]} label="Name" />
              <Text f={f} path={[...p, "issuer"]} label="Issuer" />
              <Month f={f} path={[...p, "date"]} label="Date" />
              <Text f={f} path={[...p, "url"]} label="Link" type="url" />
            </Grid>
          )}
        />
      </Section>

      <Section title="Voluntary self-identification">
        <p className="ez-help">
          Only ever used word for word, on forms that ask. Leave a field empty to be asked each time; write “decline” to
          choose the form's decline-to-answer option.
        </p>
        <Grid>
          <Text f={f} path={["eeo", "gender"]} label="Gender" />
          <Text f={f} path={["eeo", "race"]} label="Race or ethnicity" />
          <Text f={f} path={["eeo", "hispanicOrLatino"]} label="Hispanic or Latino" />
          <Text f={f} path={["eeo", "veteranStatus"]} label="Veteran status" />
          <Text f={f} path={["eeo", "disability"]} label="Disability" />
          <Text f={f} path={["eeo", "sexualOrientation"]} label="Sexual orientation" />
        </Grid>
      </Section>

      <div className="ob-actions ob-sticky">
        <Button
          variant="primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            setErrors(null);
            try {
              const r = await act<{ ok: boolean; errors?: { path: string; message: string }[] }>("profile", {
                value: forSaving(value),
              });
              if (r.ok) {
                setDirty(false);
                setSaved(true);
              } else setErrors(r.errors ?? []);
            } catch (e) {
              setError(messageOf(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          Save profile
        </Button>
        {saved ? <span className="ob-saved">Saved</span> : null}
        {errors?.length ? (
          <span className="ob-error-count">
            {errors.length} {errors.length === 1 ? "field needs" : "fields need"} fixing
          </span>
        ) : null}
      </div>
      <ErrorNote error={error} />
    </>
  );
}

// ---- the form's parts ---------------------------------------------------------------------------

interface F {
  get(path: (string | number)[]): unknown;
  set(path: (string | number)[], v: unknown): void;
  missing: Set<string>;
  invalid: Map<string, string>;
}

function Section({ title, flagged, children }: { title: string; flagged?: boolean; children: ReactNode }) {
  return (
    <section className="ob-section">
      <h3>
        {title} {flagged ? <span className="ez-badge ez-badge-warn">needed</span> : null}
      </h3>
      {children}
    </section>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="ob-grid">{children}</div>;
}

function Field({
  f,
  path,
  label,
  flag,
  required,
  children,
}: {
  f: F;
  path: (string | number)[];
  label: string;
  flag?: string;
  required?: boolean;
  children(id: string, invalid: boolean): ReactNode;
}) {
  const key = path.join(".");
  const id = `ob-f-${key.replace(/\W+/g, "-")}`;
  const problem = f.invalid.get(key);
  const wanted = flag !== undefined && f.missing.has(flag) && !f.get(path);
  return (
    <div className={`ez-field${wanted ? " ob-wanted" : ""}`}>
      <label className="ez-label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
        {wanted ? <span className="ez-badge ez-badge-warn">often asked</span> : null}
      </label>
      {children(id, !!problem)}
      {problem ? <span className="ob-field-error">{problem}</span> : null}
    </div>
  );
}

function Text({
  f,
  path,
  label,
  type = "text",
  placeholder,
  required,
  flag,
}: {
  f: F;
  path: (string | number)[];
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  flag?: string;
}) {
  return (
    <Field f={f} path={path} label={label} flag={flag} required={required}>
      {(id, bad) => (
        <input
          id={id}
          className="ez-input"
          type={type}
          value={(f.get(path) as string | undefined) ?? ""}
          placeholder={placeholder}
          required={required}
          aria-invalid={bad || undefined}
          onChange={(e) => f.set(path, e.target.value)}
        />
      )}
    </Field>
  );
}

function Num({ f, path, label }: { f: F; path: (string | number)[]; label: string }) {
  return (
    <Field f={f} path={path} label={label}>
      {(id, bad) => (
        <input
          id={id}
          className="ez-input"
          type="number"
          min={0}
          max={100}
          value={(f.get(path) as number | undefined) ?? ""}
          aria-invalid={bad || undefined}
          onChange={(e) => f.set(path, e.target.value === "" ? "" : Number(e.target.value))}
        />
      )}
    </Field>
  );
}

function Month({ f, path, label, required }: { f: F; path: (string | number)[]; label: string; required?: boolean }) {
  return (
    <Field f={f} path={path} label={label} required={required}>
      {(id, bad) => (
        <input
          id={id}
          className="ez-input"
          type="month"
          value={(f.get(path) as string | undefined) ?? ""}
          aria-invalid={bad || undefined}
          onChange={(e) => f.set(path, e.target.value)}
        />
      )}
    </Field>
  );
}

/** A job's end: a month, or none for the job the user has now. */
function EndMonth({ f, path }: { f: F; path: (string | number)[] }) {
  const current = f.get(path) === null || f.get(path) === undefined;
  return (
    <Field f={f} path={path} label="Ended">
      {(id, bad) => (
        <div className="ob-row">
          <input
            id={id}
            className="ez-input"
            type="month"
            disabled={current}
            value={current ? "" : ((f.get(path) as string) ?? "")}
            aria-invalid={bad || undefined}
            onChange={(e) => f.set(path, e.target.value || null)}
          />
          <label className="ob-check">
            <input type="checkbox" checked={current} onChange={(e) => f.set(path, e.target.checked ? null : "")} /> Now
          </label>
        </div>
      )}
    </Field>
  );
}

function Select({ f, path, label, options }: { f: F; path: (string | number)[]; label: string; options: string[] }) {
  return (
    <Field f={f} path={path} label={label}>
      {(id) => (
        <select
          id={id}
          className="ez-select"
          value={(f.get(path) as string | undefined) ?? ""}
          onChange={(e) => f.set(path, e.target.value)}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o ? o.charAt(0).toUpperCase() + o.slice(1).replace(/-/g, " ") : "Not said"}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Yes, no, or not said (left out of the file, so forms ask). */
function YesNo({ f, path, label, flag }: { f: F; path: (string | number)[]; label: string; flag?: string }) {
  const v = f.get(path);
  return (
    <Field f={f} path={path} label={label} flag={flag}>
      {(id) => (
        <select
          id={id}
          className="ez-select"
          value={v === true ? "yes" : v === false ? "no" : ""}
          onChange={(e) => f.set(path, e.target.value === "yes" ? true : e.target.value === "no" ? false : "")}
        >
          <option value="">Not said</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      )}
    </Field>
  );
}

/** A list of short values, comma-separated in one field. */
function Words({ f, path, label, flag }: { f: F; path: (string | number)[]; label: string; flag?: string }) {
  const list = (f.get(path) as string[] | undefined) ?? [];
  const [text, setText] = useState(list.join(", "));
  const [last, setLast] = useState(list);
  if (list !== last && list.join(", ") !== split(text).join(", ")) {
    setLast(list);
    setText(list.join(", "));
  }
  return (
    <Field f={f} path={path} label={label} flag={flag}>
      {(id) => (
        <input
          id={id}
          className="ez-input"
          value={text}
          placeholder="Separate with commas"
          onChange={(e) => {
            setText(e.target.value);
            f.set(path, split(e.target.value));
          }}
        />
      )}
    </Field>
  );
}

/** A list of sentences, one per line. */
function Lines({ f, path, label }: { f: F; path: (string | number)[]; label: string }) {
  const list = (f.get(path) as string[] | undefined) ?? [];
  return (
    <Field f={f} path={path} label={label}>
      {(id) => (
        <textarea
          id={id}
          className="ez-textarea"
          rows={Math.max(2, list.length + 1)}
          value={list.join("\n")}
          onChange={(e) => f.set(path, e.target.value.split("\n"))}
        />
      )}
    </Field>
  );
}

function List({
  f,
  path,
  noun,
  blank,
  render,
}: {
  f: F;
  path: (string | number)[];
  noun: string;
  blank: Obj;
  render(path: (string | number)[]): ReactNode;
}) {
  const items = (f.get(path) as Obj[] | undefined) ?? [];
  return (
    <div className="ob-items">
      {items.map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the form edits items in place by position
        <div key={i} className="ob-item">
          <div className="ob-item-head">
            <span className="ez-muted">
              {noun.charAt(0).toUpperCase() + noun.slice(1)} {i + 1}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${noun} ${i + 1}`}
              onClick={() =>
                f.set(
                  path,
                  items.filter((__, j) => j !== i),
                )
              }
            >
              <Icon name="trash" size={15} /> Remove
            </Button>
          </div>
          {render([...path, i])}
        </div>
      ))}
      <Button size="sm" onClick={() => f.set(path, [...items, structuredClone(blank)])}>
        + Add {items.length ? "another " : "a "}
        {noun}
      </Button>
    </div>
  );
}

// ---- data ---------------------------------------------------------------------------------------

function split(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function getIn(o: unknown, path: (string | number)[]): unknown {
  let cur = o;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

function setIn(o: Obj, path: (string | number)[], v: unknown): Obj {
  const [k, ...rest] = path;
  if (k === undefined) return o;
  const copy: Obj | unknown[] = Array.isArray(o) ? [...o] : { ...o };
  const child = (copy as Record<string | number, unknown>)[k];
  (copy as Record<string | number, unknown>)[k] = rest.length
    ? setIn((child && typeof child === "object" ? child : typeof rest[0] === "number" ? [] : {}) as Obj, rest, v)
    : v;
  return copy as Obj;
}

/**
 * The form's data as the companion takes it. In objects, an empty field stays "" (the companion removes that key);
 * in list items, which are written whole, empty fields are dropped, and blank lines go. A phone without a number
 * isn't a phone.
 */
export function forSaving(value: Obj): Obj {
  const out = structuredClone(value);
  const contact = out.contact as Obj | undefined;
  const phone = contact?.phone as Obj | undefined;
  if (contact && phone && !String(phone.number ?? "").trim()) contact.phone = "";
  for (const key of ["work", "education", "skills", "languages", "certifications"]) {
    if (Array.isArray(out[key])) out[key] = (out[key] as Obj[]).map(cleanItem);
  }
  const links = out.links as Obj | undefined;
  if (links && Array.isArray(links.other)) {
    links.other = (links.other as Obj[]).map(cleanItem).filter((l) => l.label || l.url);
  }
  return out;
}

function cleanItem(item: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(item)) {
    if (v === "" || v === undefined) continue;
    out[k] = Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : x)).filter((x) => x !== "") : v;
  }
  return out;
}
