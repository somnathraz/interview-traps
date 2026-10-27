import { performance } from "node:perf_hooks";
import type { StoreState, TraceEvent } from "./trace-schema.ts";

/**
 * Records what actually happened during a run. Timestamps are real.
 * Pass `noopTracer` when you just want to run the code without recording.
 */
export interface Tracer {
  event(e: Omit<TraceEvent, "t" | "state">, opts?: { snapshot?: boolean }): Promise<void>;
}

export class RecordingTracer implements Tracer {
  readonly events: TraceEvent[] = [];
  private readonly start = performance.now();

  constructor(private readonly snapshot: () => Promise<StoreState>) {}

  async event(e: Omit<TraceEvent, "t" | "state">, opts: { snapshot?: boolean } = {}) {
    const t = Math.round((performance.now() - this.start) * 10) / 10;
    const entry: TraceEvent = { t, ...e };
    // Push first so ordering reflects when the event happened, not when the snapshot query finished.
    this.events.push(entry);
    if (opts.snapshot) entry.state = await this.snapshot();
  }
}

export const noopTracer: Tracer = { async event() {} };
