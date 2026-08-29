import test from "node:test";
import assert from "node:assert/strict";

import { Container } from "../di/container.ts";
import { token } from "../di/token.ts";

interface Clock {
  now(): number;
}

interface UserStore {
  nameFor(id: string): string;
}

const CLOCK = token<Clock>("clock");
const USER_STORE = token<UserStore>("user-store");
const AUDIT = token<AuditService>("audit");
const MISSING = token<Clock>("missing");

class SystemClock implements Clock {
  now(): number {
    return 1_700_000_000_000;
  }
}

class FakeClock implements Clock {
  private readonly fixed: number;

  constructor(fixed: number) {
    this.fixed = fixed;
  }

  now(): number {
    return this.fixed;
  }
}

class AuditService {
  static readonly deps = [CLOCK, USER_STORE] as const;

  private readonly clock: Clock;
  private readonly users: UserStore;

  constructor(clock: Clock, users: UserStore) {
    this.clock = clock;
    this.users = users;
  }

  entryFor(id: string): string {
    return `${this.clock.now()}:${this.users.nameFor(id)}`;
  }
}

class CountingService {
  static instanceCount = 0;
  static readonly deps = [] as const;
  constructor() {
    CountingService.instanceCount++;
  }
}

test("registerValue resolves the exact instance", () => {
  const c = new Container();
  const clock = new SystemClock();
  c.registerValue(CLOCK, clock);
  assert.equal(c.resolve(CLOCK), clock);
});

test("registerClass auto-wires static deps in order", () => {
  const c = new Container();
  c.registerClass(AUDIT, AuditService);
  c.registerValue(CLOCK, new FakeClock(42));
  c.registerValue(USER_STORE, { nameFor: (id) => `user-${id}` });

  const audit = c.resolve(AUDIT);
  assert.ok(audit instanceof AuditService);
  assert.equal(audit.entryFor("7"), "42:user-7");
});

test("resolving a service with a fake repository exercises real logic", () => {
  const c = new Container();
  c.registerClass(AUDIT, AuditService);
  c.registerValue(CLOCK, new FakeClock(0));
  c.registerValue(USER_STORE, { nameFor: () => "stub" });

  assert.equal(c.resolve(AUDIT).entryFor("x"), "0:stub");
});

test("singleton memoises, transient does not", () => {
  CountingService.instanceCount = 0;

  const single = new Container();
  single.registerClass(token<CountingService>("s"), CountingService, { singleton: true });
  single.resolve(token<CountingService>("s"));
  single.resolve(token<CountingService>("s"));
  assert.equal(CountingService.instanceCount, 1);

  CountingService.instanceCount = 0;
  const transient = new Container();
  transient.registerClass(token<CountingService>("t"), CountingService);
  transient.resolve(token<CountingService>("t"));
  transient.resolve(token<CountingService>("t"));
  assert.equal(CountingService.instanceCount, 2);
});

test("child inherits parent registrations and can override them", () => {
  const root = new Container();
  root.registerClass(AUDIT, AuditService);
  root.registerValue(CLOCK, new FakeClock(1));
  root.registerValue(USER_STORE, { nameFor: (id) => id });

  assert.equal(root.resolve(AUDIT).entryFor("a"), "1:a");

  const child = root.child();
  child.registerValue(CLOCK, new FakeClock(99));
  assert.equal(child.resolve(AUDIT).entryFor("a"), "99:a");
  assert.equal(root.resolve(AUDIT).entryFor("a"), "1:a");
});

test("has() reports registrations from ancestors", () => {
  const root = new Container();
  root.registerValue(CLOCK, new SystemClock());
  assert.equal(root.has(CLOCK), true);
  assert.equal(root.child().has(CLOCK), true);
  assert.equal(new Container().has(CLOCK), false);
});

test("resolve throws a named error for unregistered tokens", () => {
  const c = new Container();
  assert.throws(() => c.resolve(MISSING), /DI: nothing registered for "missing"/);
});
