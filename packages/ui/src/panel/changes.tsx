import type { WorkspaceChanges } from "@ezapply/protocol";
import { useEffect, useState } from "react";
import { WorkspaceChangesList } from "../components/changes.js";
import { Button } from "../components/ui.js";
import type { PanelTransport } from "./transport.js";

/**
 * The Workspace changes card above a conversation: what's out of date in the workspace, read again whenever the
 * companion says something changed (`tick`). Nothing listed, no card. With `gate`, Tailor or Fill was pressed while
 * the work needs a change: the card opens and the request waits for **Go on**.
 */
export function ChangesCard({
  transport,
  conversation,
  agentName,
  tick,
  gate,
}: {
  transport: PanelTransport;
  conversation: string;
  agentName: string;
  tick: number;
  gate?: { onGoOn(): void; onCancel(): void };
}) {
  const [data, setData] = useState<WorkspaceChanges | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is what triggers the read again
  useEffect(() => {
    let live = true;
    transport.call("panel.workspaceChanges", { key: conversation }).then(
      (d) => {
        if (live) setData(Array.isArray(d?.changes) ? d : null);
      },
      () => {
        if (live) setData(null);
      },
    );
    return () => {
      live = false;
    };
  }, [transport, conversation, tick]);

  if (!gate && !data?.changes.length) return null;
  const changes = data?.changes ?? [];
  const needed = changes.filter((c) => c.needed && !c.working).length;
  return (
    <details className="ez-panel-changes" open={gate ? true : undefined}>
      <summary>
        Workspace changes · {changes.length}
        {needed ? <span className="ez-muted"> · {needed} this work uses</span> : null}
      </summary>
      {gate ? (
        <p className="ez-help">
          {needed
            ? "This work draws on what's out of date. Update it first, or go on with what's there."
            : "Nothing this work uses is out of date now."}
        </p>
      ) : null}
      {data ? (
        <WorkspaceChangesList
          data={data}
          agentName={agentName}
          act={(req) => transport.call("panel.workspaceChange", { key: conversation, ...req })}
        />
      ) : null}
      {gate ? (
        <div className="ez-changes-actions">
          <Button size="sm" variant="primary" onClick={gate.onGoOn}>
            {needed ? "Go on anyway" : "Go on"}
          </Button>
          <Button size="sm" variant="ghost" onClick={gate.onCancel}>
            Cancel
          </Button>
        </div>
      ) : null}
    </details>
  );
}
