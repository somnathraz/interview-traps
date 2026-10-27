import type pg from "pg";
import type { Actor, StoreState } from "./trace-schema.ts";
import type { Tracer } from "./tracer.ts";

export type VariantName = "bug" | "fix";

export interface RunResult {
  /** what each user was told */
  responses: Record<string, string>;
  /** store state when everything settled */
  finalState: StoreState;
}

/**
 * Every episode folder exports one of these from episode.ts.
 * The run CLI, the proof test and the trace builder all go through it.
 */
export interface Episode {
  slug: string;
  number: number;
  title: string;
  question: string;
  why: string;
  rule: string;
  reel?: string | null;
  /** users used for the replay trace. Keep it small (2-3) so the sim is readable. */
  traceUsers: string[];
  variantLabels: Record<VariantName, string>;
  actors(users: string[]): Actor[];
  reset(pool: pg.Pool): Promise<void>;
  snapshot(pool: pg.Pool): Promise<StoreState>;
  run(pool: pg.Pool, variant: VariantName, users: string[], tracer: (user: string) => Tracer): Promise<RunResult>;
  /** one-line verdict for a run, used by the CLI and the sim */
  verdict(variant: VariantName, result: RunResult): { ok: boolean; headline: string };
}
