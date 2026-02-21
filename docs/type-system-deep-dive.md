# DeepMocked Type System: Design & Research

This document captures the research, exploration, and decisions behind the `DeepMocked` type system in `vitest-create-mock`.

## Goal

We wanted to understand how far `createMock` could be pushed with complex, real-world TypeScript types. Specifically, we set out to mock [Kysely](https://kysely.dev/) — a type-safe SQL query builder with deeply nested, heavily overloaded generic method chains — to prove that `createMock` could handle advanced patterns out of the box.

Along the way, we wanted to improve the type system to be more robust without sacrificing the simple, zero-config DX that makes `createMock` useful.

## What We Explored

### Kysely as a Stress Test

Kysely's query builder uses a pattern like:

```typescript
db.selectFrom("users")
  .select(["id", "name"])
  .where("id", "=", 1)
  .executeTakeFirst();
```

Each method returns a new builder type with updated generics, and many methods have 10+ overloads. This makes Kysely one of the most complex type signatures in the TypeScript ecosystem.

We wrote 21 tests covering SELECT, INSERT, UPDATE, DELETE, JOINs, subqueries, and transactions. **All 21 tests passed at runtime** — the proxy-based mock handled chaining perfectly. The problem was entirely at the type level.

### TypeScript Complexity Limits

Kysely's overloaded methods produce massive union types. TypeScript hit its internal limit:

```
Expression produces a union type that is too complex to represent.
```

We explored several approaches to work around this:

1. **`@ts-nocheck`** — Works but defeats the purpose. If consumers need this, we've failed at absorbing complexity.

2. **MockProxy intersection types** — Attempted to intersect our mock type with Kysely's types. Failed because conflicting function signatures in the union couldn't be resolved.

3. **Depth-limited recursion** — Used tuple types to cap how deep the type system recurses. Helped reduce the scope of type expansion, but Kysely's overloads still exceeded limits at any depth.

4. **Permissive function typing at all depths** — Made all mocked functions accept `(...args: any[]) => any`. This fixed Kysely but **broke simple interfaces**: `mock.switchToHttp()` returned `any` instead of its proper type. This was the critical finding — we couldn't sacrifice DX for simple cases to support an edge case.

### The Key Tradeoff

> "We can't lose simpler test types like `const httpContext = mock.switchToHttp()` to become `any`. Failing to mock Kysely is more acceptable than losing the simpler types."

This became the guiding principle: **protect simple interfaces first**. Complex libraries that exceed TypeScript's limits are an acceptable boundary.

### Kysely's Own Recommendation

Before committing to more work, we checked Kysely's official docs and found they explicitly recommend **not mocking Kysely**:

- [CONTRIBUTING.md](https://github.com/kysely-org/kysely/blob/master/CONTRIBUTING.md): *"No mocks. Everything is tested against real database instances."*
- [GitHub Issue #801](https://github.com/kysely-org/kysely/issues/801): Community discussion confirms mocking the chainable API is impractical.
- Their recommended testing approach: use real databases (SQLite for unit tests) or wrap Kysely behind a repository layer and mock the wrapper.

This validated our decision to not chase Kysely compatibility.

## What We Ended Up With

We kept the type improvements that emerged from the exploration — they benefit everyday interfaces without any downsides.

### Depth-Limited Recursion

The type system now uses tuple types to track recursion depth:

```typescript
type DecrementDepth<D extends number[]> = D extends [unknown, ...infer Rest]
  ? Rest extends number[] ? Rest : []
  : [];

type DefaultDepth = [1, 1, 1, 1, 1]; // 5 levels
```

- **At depths 2-5**: Full typing with `Parameters<T>`, `ReturnType<T>`, and `Mock<T>`.
- **At depths 0-1**: Falls back to permissive `(...args: any[]) => any & Mock` to avoid complexity explosion.
- **At depth 0**: Returns `any` entirely, allowing continued chaining without type errors.

For typical interfaces (2-3 levels of nesting), this is invisible — everything is fully typed. The fallback only kicks in for extremely deep chains.

### Promise Special Handling

Previously, `Promise<T>` would be deeply mocked like any other object, which broke `await`:

```typescript
// Before: TypeScript confused by mocked 'then' property
const result = await mock.fetchData(); // type error

// After: Promise<T> unwraps correctly
const result = await mock.fetchData(); // properly typed
```

The fix:

```typescript
type DeepMockedWithDepth<T, D extends number[]> =
  // ...
  T extends Promise<infer U>
    ? Promise<DeepMockedWithDepth<U, DecrementDepth<D>>>
    : // ... normal mapped type
```

### Excluded Properties

`then` and `asymmetricMatch` are excluded from the mapped type, matching what the runtime proxy already does:

```typescript
type ExcludedMockProperties = 'then' | 'asymmetricMatch';
```

- **`then`**: Prevents mocks from being treated as thenables by the runtime.
- **`asymmetricMatch`**: Prevents interference with Vitest's matcher system.

### Double Cast on Return

The `createMock` return now uses `as unknown as DeepMocked<T>` instead of a direct cast. This is necessary because the conditional types in `DeepMockedWithDepth` prevent TypeScript from directly asserting the proxy result.

## Summary

| Approach | Outcome |
|---|---|
| Mock Kysely with `@ts-nocheck` | Works but poor DX |
| Mock Kysely with intersection types | Failed — conflicting signatures |
| Depth-limited recursion | Helped but insufficient for Kysely's overloads |
| Permissive typing everywhere | Fixed Kysely, broke simple interfaces |
| **Depth-limited + permissive at deep levels only** | **Kept — protects simple types, gracefully degrades** |
| **Promise special handling** | **Kept — fixes await on mocked async functions** |
| **Excluded properties in types** | **Kept — aligns types with runtime proxy behavior** |

The type system now handles 5 levels of nesting with full type safety, gracefully falls back for deeper chains, correctly handles Promises, and excludes properties that would interfere with runtime behavior. Libraries like Kysely that exceed TypeScript's complexity limits remain unsupported at the type level — this is an acceptable boundary given Kysely's own recommendation to not mock it.

## Recipe: Mocking Fluent / Chainable Libraries

If you're working with a fluent API like Kysely, Prisma, Knex, or similar query builders, **don't mock the library directly**. Instead, define a narrow, app-owned interface and mock that.

### The Problem

Fluent builders return a new builder type at every step, with heavily overloaded generics. TypeScript can't expand these deeply enough without hitting complexity limits — and this is true for any mocking library, not just `createMock`.

### The Pattern

Instead of this:

```typescript
// Don't do this — mocking the full Kysely surface
import type { Kysely } from "kysely";

const db = createMock<Kysely<Database>>();
// TypeScript: "Expression produces a union type that is too complex"
```

Define a repository interface that owns the contract:

```typescript
// Define what your app actually needs
interface UserRepository {
  findById(id: number): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  create(user: NewUser): Promise<User>;
  update(id: number, changes: Partial<User>): Promise<User>;
  delete(id: number): Promise<void>;
}
```

Then mock the interface:

```typescript
const repo = createMock<UserRepository>();

repo.findById.mockResolvedValueOnce({ id: 1, name: "Alice", email: "alice@example.com" });

const user = await repo.findById(1);
expect(user?.name).toBe("Alice");
```

### Why This Works

1. **Your interface is simple** — flat methods with concrete types, no overloaded generics.
2. **Full type safety** — `createMock` handles these interfaces perfectly.
3. **Better architecture** — your business logic depends on an abstraction, not a library. Swapping Kysely for Drizzle or raw SQL only changes the repository implementation, not every test.
4. **Kysely agrees** — their own docs recommend testing against real databases or wrapping behind an abstraction layer.

This pattern applies to any library with a complex fluent API: Prisma's query builders, Knex chains, TypeORM query builders, etc. Mock the boundary you own, not the library you consume.
