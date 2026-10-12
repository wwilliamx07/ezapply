import type { OnboardRepo } from "@ezapply/protocol";
import { useEffect, useMemo, useState } from "react";
import { Badge, Banner, Button, Icon, Spinner } from "../components/ui.js";
import { getJson } from "../lib/api.js";
import { Copyable, ErrorNote, StepHead, TaskStatus, useBusy } from "./parts.js";
import { messageOf, useOnboard } from "./state.js";

export function TexStep() {
  const { state, ask, refresh } = useOnboard();
  const busy = useBusy(["install-tex"]);
  return (
    <>
      <StepHead title="LaTeX" done={state.tex.done}>
        ezapply builds your resume and cover letters with LaTeX, on this computer.
      </StepHead>
      {state.tex.done ? (
        <p>
          Found: <code>{state.tex.detail.replace(/^engine: /, "")}</code>
        </p>
      ) : (
        <>
          <p>No LaTeX engine is installed. Claude can install it for you with this command:</p>
          <Copyable value={state.tex.installCommand} label="Install command" />
          <p className="ez-help">
            Claude runs it once you approve it{state.agentIn === "panel" ? " in the ezapply panel" : " in the terminal"}
            . It takes a few minutes and several hundred MB.
          </p>
          <div className="ob-actions">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => ask("install-tex", { command: state.tex.installCommand })}
            >
              Ask Claude to install it
            </Button>
            <Button variant="ghost" onClick={refresh}>
              Check again
            </Button>
          </div>
        </>
      )}
      <TaskStatus kinds={["install-tex"]} />
    </>
  );
}

export function ExtensionStep() {
  const { state, act } = useOnboard();
  const ext = state.extension;
  const [error, setError] = useState<string | null>(null);
  const label = ext.browser ? ext.browser.charAt(0).toUpperCase() + ext.browser.slice(1) : "your browser";
  return (
    <>
      <StepHead title="Browser extension" done={ext.connected}>
        The extension captures postings and fills in applications in your browser. It never submits one.
      </StepHead>
      {ext.connected ? (
        <p>Connected in {label}.</p>
      ) : (
        <>
          {!ext.built ? (
            <Banner tone="warn" icon={<Icon name="alert" />}>
              The extension isn't built yet. Run <code>npm run setup</code> in the ezapply folder, then come back.
            </Banner>
          ) : null}
          <p>Chrome, Edge, Brave or another Chromium browser:</p>
          <ol className="ob-steps">
            <li>
              Open the extensions page (<code>chrome://extensions</code>, or <code>edge://extensions</code> in Edge):
              paste it into the address bar.
            </li>
            <li>Turn on Developer mode (top right), then click Load unpacked.</li>
            <li>
              Choose this folder:
              {ext.chromeFolder ? <Copyable value={ext.chromeFolder} label="Extension folder" /> : null}
            </li>
          </ol>
          <div className="ob-actions">
            <Button
              variant="primary"
              onClick={async () => {
                setError(null);
                try {
                  await act("pair");
                } catch (e) {
                  setError(messageOf(e));
                }
              }}
            >
              {ext.pairingOpen ? "Waiting for the extension…" : "I've loaded it: connect"}
            </Button>
            {ext.pairingOpen ? <Spinner label="Waiting for the extension" /> : null}
          </div>
          {ext.pairingOpen ? (
            <p className="ez-help">
              It connects by itself within a few seconds of loading. For the next 15 minutes, a new copy pairs without a
              code.
            </p>
          ) : null}
          <ErrorNote error={error} />
        </>
      )}
    </>
  );
}

export function GitHubStep() {
  const { state, act } = useOnboard();
  const gh = state.github;
  const [app, setApp] = useState<"new" | "existing">("new");
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const connect = async () => {
    setError(null);
    // Opened in the click, so the browser allows it; pointed at GitHub's flow once the companion gives its address.
    const tab = window.open("about:blank", "_blank");
    try {
      const { url } = await act<{ url: string }>("github", gh.appRegistered ? {} : { app });
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setOpened(true);
    } catch (e) {
      tab?.close();
      setError(messageOf(e));
    }
  };
  return (
    <>
      <StepHead title="GitHub" done={gh.loggedIn && !gh.problem}>
        Your code is the evidence behind what your resume claims. ezapply reads the repositories you choose, never
        writes to them.
      </StepHead>
      {gh.problem ? (
        <Banner tone="warn" icon={<Icon name="alert" />}>
          {gh.problem}
        </Banner>
      ) : null}
      {gh.loggedIn ? (
        <p>
          Logged in as <b>{gh.login}</b>.
        </p>
      ) : (
        <>
          {!gh.appRegistered ? (
            <fieldset className="ob-choice">
              <legend className="ez-label">Your ezapply GitHub App</legend>
              <label>
                <input type="radio" checked={app === "new"} onChange={() => setApp("new")} /> Create a new one{" "}
                <span className="ez-muted">(private and read-only: you choose which repositories it sees)</span>
              </label>
              <label>
                <input type="radio" checked={app === "existing"} onChange={() => setApp("existing")} /> I already have
                one <span className="ez-muted">(from another computer: it's listed at github.com/settings/apps)</span>
              </label>
            </fieldset>
          ) : null}
          <div className="ob-actions">
            <Button variant="primary" onClick={connect}>
              Continue on GitHub
            </Button>
          </div>
          {opened ? (
            <p className="ez-help">
              Finish in the tab that opened
              {app === "existing" && !gh.appRegistered
                ? " (its Client ID and secret go on that page, not in the chat)"
                : ""}
              . This page moves on by itself when you're logged in.
            </p>
          ) : null}
          <ErrorNote error={error} />
        </>
      )}
    </>
  );
}

export function ReposStep() {
  const { state, base, act } = useOnboard();
  const [repos, setRepos] = useState<OnboardRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [showSkipped, setShowSkipped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!state.github.loggedIn) return;
    getJson<OnboardRepo[]>(`${base}/repos`).then(
      (list) => {
        setRepos(list);
        const already = list.filter((r) => r.selected);
        setPicked(new Set((already.length ? already : list.filter((r) => r.suggested)).map((r) => r.fullName)));
      },
      () => setError("Your repositories couldn't be listed. Check the GitHub step, then reload this page."),
    );
  }, [base, state.github.loggedIn]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos ?? []).filter(
      (r) =>
        (showSkipped || !r.skipReason || picked.has(r.fullName)) &&
        (!q || r.fullName.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q)),
    );
  }, [repos, query, showSkipped, picked]);

  const done = state.steps.find((s) => s.id === "repos")?.done ?? false;
  if (!state.github.loggedIn) {
    return (
      <>
        <StepHead title="Repositories" done={done} />
        <p>Log in to GitHub first (the step before this one).</p>
      </>
    );
  }
  const toggle = (name: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      setSaved(false);
      return n;
    });
  const skipped = (repos ?? []).filter((r) => r.skipReason).length;
  return (
    <>
      <StepHead title="Repositories" done={done}>
        Choose the projects that show your work. Claude reads each one and writes down what it shows you did, with the
        lines of code that prove it.
      </StepHead>
      {error ? <ErrorNote error={error} /> : null}
      {!repos && !error ? <Spinner label="Listing your repositories" /> : null}
      {repos ? (
        <>
          <div className="ob-row ob-filter">
            <input
              className="ez-input"
              type="search"
              placeholder="Search"
              aria-label="Search repositories"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {skipped ? (
              <label className="ob-check">
                <input type="checkbox" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} /> Show{" "}
                {skipped} left out (forks, archived, empty, config)
              </label>
            ) : null}
          </div>
          <ul className="ob-repos">
            {shown.map((r) => (
              <li key={r.fullName}>
                <label className={`ob-repo${picked.has(r.fullName) ? " ob-repo-on" : ""}`}>
                  <input type="checkbox" checked={picked.has(r.fullName)} onChange={() => toggle(r.fullName)} />
                  <span className="ob-repo-text">
                    <span className="ob-repo-name">
                      {r.fullName}
                      {r.private ? <Badge>private</Badge> : null}
                      {r.skipReason ? <Badge tone="warn">{r.skipReason}</Badge> : null}
                    </span>
                    {r.description ? <span className="ob-repo-desc">{r.description}</span> : null}
                    <span className="ob-repo-meta">
                      {[
                        r.language,
                        r.pushedAt
                          ? `pushed ${new Date(r.pushedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {state.github.manageUrl ? (
            <p className="ez-help">
              A repository missing?{" "}
              <a href={state.github.manageUrl} target="_blank" rel="noreferrer">
                Give the app access to it
              </a>
              , then reload this page.
            </p>
          ) : null}
          <div className="ob-actions">
            <Button
              variant="primary"
              disabled={saving || picked.size === 0}
              onClick={async () => {
                setSaving(true);
                setError(null);
                try {
                  await act("repos", { repos: [...picked] });
                  setSaved(true);
                } catch (e) {
                  setError(messageOf(e));
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save {picked.size} {picked.size === 1 ? "repository" : "repositories"}
            </Button>
            {saved ? <span className="ob-saved">Saved</span> : null}
          </div>
        </>
      ) : null}
    </>
  );
}

export function KnowledgeStep() {
  const { state, ask } = useOnboard();
  const busy = useBusy(["index-repos"]);
  const { selected, indexed } = state.repos;
  const todo = selected.filter((r) => !indexed[r]);
  const done = state.steps.find((s) => s.id === "knowledge")?.done ?? false;
  return (
    <>
      <StepHead title="Your projects, read" done={done}>
        Claude reads each repository you chose and writes down what you built in it, each point backed by the code. Your
        resume and cover letters draw only on what it finds there and in your profile.
      </StepHead>
      {selected.length === 0 ? (
        <p>Choose repositories first (the step before this one).</p>
      ) : (
        <>
          <ul className="ob-list">
            {selected.map((r) => (
              <li key={r}>
                {indexed[r] ? (
                  <Icon name="check" size={16} />
                ) : busy ? (
                  <Spinner />
                ) : (
                  <span className="ob-dot" aria-hidden="true" />
                )}{" "}
                <code>{r}</code>{" "}
                <span className="ez-muted">
                  {indexed[r]
                    ? `read ${new Date(indexed[r] as string).toLocaleDateString()}`
                    : busy
                      ? "reading…"
                      : "not read yet"}
                </span>
              </li>
            ))}
          </ul>
          {todo.length ? (
            <div className="ob-actions">
              <Button variant="primary" disabled={busy} onClick={() => ask("index-repos", { repos: todo })}>
                Have Claude read {todo.length} {todo.length === 1 ? "repository" : "repositories"}
              </Button>
              <span className="ez-help">This takes a few minutes per repository. You can go on meanwhile.</span>
            </div>
          ) : null}
        </>
      )}
      <TaskStatus kinds={["index-repos"]} />
    </>
  );
}
