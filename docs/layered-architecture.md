# Layered Architecture

Target architecture for the ServiceNow Ticket Analyzer. This document
**supersedes `docs/architecture.md`** (which describes the pre-migration viewer
module graph) and is the reference for all new work. The old doc is deleted at
the end of Phase 5.

The codebase is moving to four explicit layers plus a DI container, written in
TypeScript, with OOP components that own their own DOM.

---

## 1. The layers

```
┌─────────────────────────────────────────────────────────────┐
│  surfaces/     panel · settings · viewer · background        │  composition roots
│                (build components, wire them to services)     │
├─────────────────────────────────────────────────────────────┤
│  components/   OOP classes: own state + own DOM              │  UI only
│                ConditionBuilder · DataGrid · ChipList · ...   │
├─────────────────────────────────────────────────────────────┤
│  services/     business logic                                │  no DOM, no storage
│                Pull · Timeline · Report · Export · Extract    │
├─────────────────────────────────────────────────────────────┤
│  data/         repositories: WHERE data lives + cache policy  │  I/O boundary
│    repositories/  ticket · timeline · settings · dataset ...  │
│    datasource/    sn-transport · servicenow-remote            │
├─────────────────────────────────────────────────────────────┤
│  core/         pure domain (today: analysis/ + pure lib/)     │  no I/O at all
│                phase2 · report · slasummary · querybuilder    │
└─────────────────────────────────────────────────────────────┘
```

**Dependency direction is strictly downward.** A component may call a service,
never a repository. A service may call repositories, never a component.
`core/` imports nothing from the layers above it.

### Layer rules

| Layer | May use | Must never |
|---|---|---|
| `core/` | nothing but `core/` | `chrome.*`, `indexedDB`, `fetch`, DOM |
| `data/` | `core/`, platform APIs | DOM, other layers |
| `services/` | `core/`, `data/` | DOM, `document.*` |
| `components/` | services injected via `deps` | repositories, `chrome.storage`, `indexedDB`, `fetch` |
| `surfaces/` | everything | containing business logic |

---

## 2. Components (OOP)

A component is a **class** that owns a private state object, creates its DOM
once, and patches that DOM on every state change.

```ts
// components/component.ts
export abstract class Component<S extends object, P = {}, D = {}> {
  protected readonly root: HTMLElement;
  protected readonly props: P;
  protected readonly deps: D;                  // injected services
  protected readonly refs: Record<string, HTMLElement> = {};
  #state: S;
  #destroyed = false;

  constructor(root: HTMLElement, props: P, deps: D) {
    this.root = root;
    this.props = props;
    this.deps = deps;
    this.#state = this.initialState();
    this.build();                              // create DOM + wire listeners ONCE
    this.patch(this.#state, null);
  }

  protected abstract initialState(): S;
  protected abstract build(): void;
  protected abstract patch(next: S, prev: S | null): void;

  protected getState(): S { return this.#state; }
  protected setState(p: Partial<S> | ((s: S) => Partial<S>)): void {
    const prev = this.#state;
    this.#state = { ...prev, ...(typeof p === "function" ? p(prev) : p) };
    this.patch(this.#state, prev);
  }
  protected emit(name: string, detail?: unknown): void {
    this.props?.on?.[name]?.(detail);
  }
  destroy(): void { this.#destroyed = true; this.root.innerHTML = ""; }
}
```

### Why `build()` once and `patch()` always

Rebuilding a subtree on every state change destroys input focus and caret
position, and for the viewer's grid (1000 rows x 30 columns) it is far too
expensive. `build()` runs exactly once; `patch()` diffs `next` against `prev`
and touches only what changed. This makes focus loss **structurally impossible**
rather than a thing you have to remember.

### The `super()` ordering rule (critical)

JavaScript initialises **subclass field declarations after `super()` returns**,
but the base constructor calls `build()`. Any field a subclass declares would
therefore be `undefined` while `build()` runs.

> **Rule: component subclasses declare no instance fields.** Everything lives in
> `this.deps` (injected), `this.props` (passed in), or `this.refs` (created in
> `build()`). Dependencies are passed **up** through `super(root, props, deps)`.

Typed refs are safe and free — `declare` emits no runtime code:

```ts
export class ConditionBuilder extends Component<CondState, CondProps, CondDeps> {
  protected declare refs: { rows: HTMLDivElement; addBtn: HTMLButtonElement };
}
```

### Component rules

1. State lives in the JS object. **Never read state back out of the DOM.**
2. No I/O inside a component — call a service from `this.deps`.
3. Components never import each other. The parent wires child callbacks.
4. State spanning components goes into a `lib/store.js` store injected via
   props. **Exactly one owner per piece of state.**

---

## 3. DI container

**No decorators.** esbuild does not implement `emitDecoratorMetadata`, so
reflection-based DI is impossible. Instead: branded string tokens (zero runtime
cost, full type inference) plus a static `deps` array for auto-wiring.

```ts
// di/token.ts
export type Token<T> = string & { readonly __brand?: T };
export const token = <T>(name: string): Token<T> => name as Token<T>;

// di/container.ts
export class Container {
  registerValue<T>(t: Token<T>, v: T): this
  register<T>(t: Token<T>, factory: (c: Container) => T, opts?: { singleton?: boolean }): this
  registerClass<T>(t: Token<T>, Ctor: ClassWithStaticDeps<T>, opts?): this
  resolve<T>(t: Token<T>): T
  child(): Container
}
```

```ts
// services/pull-service.ts
export class PullService {
  static readonly deps = [TICKET_REPO, TIMELINE_REPO, DATASET_REPO, SETTINGS_REPO] as const;

  private readonly tickets: TicketRepository;
  private readonly timelines: TimelineRepository;
  private readonly dataset: DatasetRepository;
  private readonly settings: SettingsRepository;

  constructor(tickets: TicketRepository, timelines: TimelineRepository,
              dataset: DatasetRepository, settings: SettingsRepository) {
    this.tickets = tickets; this.timelines = timelines;
    this.dataset = dataset; this.settings = settings;
  }
}
```

Explicit field assignment, **not** parameter properties — Node's type stripping
cannot transform `constructor(private x: T)` without
`--experimental-transform-types` (see §6).

### Testing

```ts
const c = createTestContainer();
c.registerValue(TICKET_REPO, new FakeTicketRepository([...records]));
const svc = c.resolve(PULL_SERVICE);   // real service, fake repository
```

Fakes live beside the real implementations in `data/repositories/fakes/`, so no
test needs an IndexedDB mock. This closes the `lib/cache.js` coverage gap
recorded in `issues/001` Priority 7.

---

## 4. Repositories

A repository owns **where** data lives and **the entire cache policy**. It is the
only layer allowed to touch `chrome.storage`, `indexedDB`, or the network.

```ts
// data/repositories/ticket-repository.ts
export interface TicketRepository {
  list(req: TicketListRequest): Promise<TicketListResult>;
  count(req: TicketCountRequest): Promise<number>;
}
```

> **The rule that makes it a repository rather than a wrapper:** cache-aside
> policy (TTL, `isFreshQuery`, `timelineNeedsFetch`, purge) lives **here**, never
> in a service. Today it is stranded in `background.js` (`processFilterSet` and
> `fetchTimelines`) — moving it is the single clearest win of Phase 1.

| Repository | Backing | Constructed in |
|---|---|---|
| `ticket`, `timeline` | IndexedDB + ServiceNow REST | **background only** |
| `settings`, `dataset`, `export-config`, `template`, `filter-list`, `run-state` | `chrome.storage.local` | all surfaces |

### The background-only split

Remote-capable repositories need the CSRF token and the content-script relay
(see the auth chain in `AGENTS.md`), so they **cannot** be constructed outside
the service worker. Pages get local repositories plus a **service bridge** that
implements the same interface over `chrome.runtime`:

```ts
// services/remote-bridge.ts  (page side)
export class PullServiceBridge implements PullService {
  run(opts: RunOptions) { return chrome.runtime.sendMessage({ type: MSG.run, ...opts }); }
}
```

Same interface, different implementation — components never know the difference.

---

## 5. Services

Business logic. No DOM, no direct storage.

`pull` · `timeline` · `report` · `export` · `extract` · `connection`

These absorb what is currently inline in `background.js`: `resolveRunSettings`,
`scopeGroups`, the max-tickets limit, the per-table `sys_id` union, the four
timeline rules wiring, `mergeRows`, and the persist + `DATA_UPDATED` broadcast.
After Phase 2, `background.js` is a ~80-line message router.

---

## 6. TypeScript conventions

Toolchain: Node **v25.7.0** (type stripping on by default), TypeScript 5.9.3,
esbuild (handles `.ts` natively).

| Rule | Reason |
|---|---|
| Import specifiers use **explicit `.ts`**: `from "./keys.ts"` | Node does **not** rewrite `.js` → `.ts`. esbuild and tsc both accept `.ts`. |
| **No** `enum`, `namespace`, or parameter properties | Node's type stripping cannot transform them; they need `--experimental-transform-types`. Use union types + explicit field assignment. Enforced by ESLint, not by memory. |
| `allowImportingTsExtensions: true`, `noEmit: true` | tsc is type-check only; esbuild does the bundling. |
| Two tsconfigs | `tsconfig.json` (`strict: false`, everything) + `tsconfig.strict.json` (`strict: true`, explicit list of migrated files that grows over time). |
| `content/content.js` stays **classic JS with zero imports** | The manifest declares it without `"type":"module"`; an ESM-emitting bundle would break it. |

### Verified by the Phase 0 pilot

These are not assumptions — they were proven on `lib/keys.ts` and `di/`:

- `node --test` **discovers `.ts` files** — but only via a **glob**. `node --test tools`
  or `node --test tools/` tries to load the directory as a module and dies with
  `MODULE_NOT_FOUND`. Use `node --test "tools/*-test.*"`.
- Parameter properties **do** hard-fail at runtime with
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. The pilot hit this in its own test file.
- `@typescript-eslint/no-explicit-any` is **off**: reflection-free DI cannot type
  its `static deps` wiring without `any`, and the base tsconfig is still
  `noImplicitAny: false`.
- `@typescript-eslint/no-parameter-properties` does not exist in v8 — the rule was
  renamed to **`@typescript-eslint/parameter-properties`**.
- `**/*.d.ts` needs its own ESLint block. `declare global` trips the
  `TSModuleDeclaration` ban and ambient `var x: any` trips `no-explicit-any`,
  but declaration files emit no JS and never reach the type stripper.
- `types/global.d.ts` keeps `"types": []` in tsconfig so its ambient `var chrome: any`
  does not collide with `@types/chrome`.

### Migrating a file

1. `git mv foo.js foo.ts`
2. Fix errors at the current (non-strict) level.
3. Rewrite `./sibling.js` import specifiers to `./sibling.ts`.
4. Add the file to `tsconfig.strict.json`'s `include` and fix strict errors.
5. Run the gate: `npm run typecheck && npm run lint && node --test tools/ && npm run build`

---

## 7. Target layout

```
core/           ← moved from analysis/ + pure lib/ in Phase 5 (no I/O, unchanged)
data/
  idb.ts
  datasource/     sn-transport.ts · servicenow-remote.ts
  repositories/   ticket · timeline · settings · dataset · export-config
                  template · filter-list · run-state · fakes/
services/       pull · timeline · report · export · extract · connection · remote-bridge
components/     component.ts · condition-builder · filter-set-list · progress-card
                log-card · chip-list · search-picker · data-grid · dialog · toast
surfaces/       panel/ · settings/ · viewer/     ← composition root per surface
platform/       background.ts (router) · content/content.js
di/             token.ts · container.ts · tokens.ts · test-container.ts
```

---

## 8. Preserved invariants

The following are **not** changed by this migration. They carry bug history and
must survive every phase — see `AGENTS.md` and `docs/invariants.md`.

- The authentication chain: tab lookup → `g_ck` cookie → MAIN-world page
  injection → content-script relay → direct fetch as last resort.
- The four timeline rules and their exactly-defined semantics.
- The instance-clock timezone contract (`fmtInstant`, `rowOffsetMs`).
- The xlsx zip-surgery export path (never regenerate with a spreadsheet library).
- The download path: export bytes are built in the viewer page, never the worker.
