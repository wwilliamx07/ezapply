# Remove the upgrade shims: details

The shims:
- moving `~/.ezapply/daemon.json` to `config.json`;
- `init`'s `ezapply.config.json` upgrades (`migrateWorkspaceConfig`): `tex.engine: latexmk` → `auto`,
  `debug.autofill` → `debug.enabled`, and dropping `forms.focusBrowser` and `context.restartOnCapture`;
- `init` backing up a pre-split 0.1 `CLAUDE.md` to `CLAUDE.md.bak`, and removing the bare-named skills of earlier
  versions (`LEGACY_SKILLS`), and removing the panel's old `agent/settings.json`;
- claims in the old `evidence` form read as `files`, and rewritten by `knowledge_mark_indexed`
  (`companion/src/repos/service.ts`);
- a template imported before `sourceHash` compared with its workspace copy file by file
  (`companion/src/templates/service.ts`);
- the agent moving a posting's single conversation (`agent/<id>`) to its tailoring one (`AgentService.upgrade`).
