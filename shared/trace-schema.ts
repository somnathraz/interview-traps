/**
 * Trace format v1: the contract between this repo and the replay engine
 * at somanathkhadanga.com/labs/traps. See TRACE_SCHEMA.md.
 *
 * Every episode's build produces ONE bundle file: <episode>/trace.json
 */

export type ActorKind = "client" | "server" | "db" | "cache" | "queue" | "external";

export interface Actor {
  id: string;
  label: string;
  kind: ActorKind;
}

export type EventType =
  | "request" // client sends something
  | "read" // reads from a store
  | "write" // mutates a store
  | "wait" // blocked or doing slow work (payment, network, lock)
  | "check" // a decision in code (if/else)
  | "response" // the answer the client gets
  | "note"; // narration only

export type Severity = "ok" | "warn" | "bad";

/** A store's visible state: table/keyspace name -> rows. */
export type StoreState = Record<string, Array<Record<string, string | number | boolean | null>>>;

export interface TraceEvent {
  /** ms since the run started (real, measured) */
  t: number;
  /** actor doing the thing */
  actor: string;
  /** actor being talked to, if any (draws an arrow) */
  target?: string;
  type: EventType;
  /** short, on-screen text */
  label: string;
  /** longer explanation shown in the event panel */
  detail?: string;
  /** which `// step: <name>` block in `source` produced this event */
  step?: string;
  severity?: Severity;
  /** full store state AFTER this event, when it changed */
  state?: StoreState;
  /** build-time only: code text used to resolve `step`. Stripped before writing trace.json */
  anchor?: string;
}

export interface Variant {
  /** "Naive check-then-act" etc */
  label: string;
  /** the exact code that ran, shown with the active step highlighted */
  source: string;
  /** step name -> [startLine, endLine], 1-based, into `source` */
  steps: Record<string, [number, number]>;
  initialState: StoreState;
  events: TraceEvent[];
  outcome: { ok: boolean; headline: string };
}

export interface TraceBundle {
  schemaVersion: 1;
  slug: string;
  number: number;
  title: string;
  /** one-line hook, the reel's opening question */
  question: string;
  /** why it breaks, 1-2 sentences */
  why: string;
  /** the interview answer / rule */
  rule: string;
  links: { repo: string; reel?: string | null };
  actors: Actor[];
  variants: { bug: Variant; fix: Variant };
  generatedAt: string;
}
