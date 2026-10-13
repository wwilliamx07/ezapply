# Remove the upgrade shims: details

The shims:
- moving `~/.ezapply/daemon.json` to `config.json`;
- `init` dropping `context.restartOnCapture`;
- the agent moving a posting's single conversation (`agent/<id>`) to its tailoring one (`AgentService.upgrade`).
