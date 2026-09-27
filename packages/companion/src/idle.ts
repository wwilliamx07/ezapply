/** Something that marks the start and end of a unit of work. */
export interface ActivityTracker {
  /** Call when work starts; call the returned function once when it ends. */
  begin(): () => void;
}

export interface IdleMonitorOptions {
  timeoutMs: number;
  /** Called once, after timeoutMs with no work in flight and nothing busy. */
  onIdle: () => void;
  /** Long-lived states that must keep the daemon up (an open pairing window, a GitHub login in progress). */
  busy?: () => boolean;
}

/**
 * Decides when the daemon has been idle long enough to stop. Work is MCP and control requests, GitHub
 * pages, and extension RPC (captures, form calls); extension keepalive pings are not work, or a connected
 * browser would keep the daemon up forever. Idle time counts from the end of the last piece of work.
 */
export class IdleMonitor implements ActivityTracker {
  private inFlight = 0;
  private lastActivity = Date.now();
  private readonly timer: NodeJS.Timeout;
  private fired = false;

  constructor(private readonly opts: IdleMonitorOptions) {
    const every = Math.max(20, Math.min(30_000, Math.floor(opts.timeoutMs / 4)));
    this.timer = setInterval(() => this.check(), every);
    this.timer.unref();
  }

  begin(): () => void {
    this.inFlight++;
    this.lastActivity = Date.now();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.inFlight--;
      this.lastActivity = Date.now();
    };
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private check(): void {
    if (this.fired) return;
    if (this.inFlight > 0 || this.opts.busy?.()) {
      this.lastActivity = Date.now(); // the idle period starts when the work or busy state ends
      return;
    }
    if (Date.now() - this.lastActivity < this.opts.timeoutMs) return;
    this.fired = true;
    this.stop();
    this.opts.onIdle();
  }
}
