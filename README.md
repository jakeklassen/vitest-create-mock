# vitest-create-mock

A utility library for creating type-safe, deeply mocked objects in [Vitest](https://vitest.dev/) tests. This is a port of [@golevelup/ts-jest](https://github.com/golevelup/nestjs/tree/master/packages/testing/ts-jest)'s `createMock` functionality, specifically designed for Vitest.

## Features

- 🎯 **Type-Safe Mocking** - Full TypeScript support with proper type inference
- 🔄 **Deep Mocking** - Automatically mocks nested properties and methods
- ⚡ **Auto-Mocking** - Automatically creates mocks for properties not explicitly provided
- 🎭 **Partial Mocking** - Provide only the properties you need to mock
- 🔒 **Strict Mode** - Optional strict mode to catch unmocked method calls
- 🧩 **Proxy-Based** - Efficient proxy-based implementation with caching
- ✨ **Promise Support** - Automatically handles async/await and promises

## Installation

```bash
pnpm add -D vitest-create-mock
```

```bash
npm install --save-dev vitest-create-mock
```

```bash
yarn add -D vitest-create-mock
```

```bash
bun add -d vitest-create-mock
```

## Quick Start

```typescript
import { createMock } from 'vitest-create-mock';
import { describe, expect, it } from 'vitest';

interface UserService {
  getUser: (id: number) => Promise<{ name: string; email: string }>;
  deleteUser: (id: number) => Promise<void>;
}

describe('UserController', () => {
  it('should get user', async () => {
    const userService = createMock<UserService>({
      getUser: async () => ({ name: 'John', email: 'john@example.com' }),
    });

    const user = await userService.getUser(1);

    expect(user.name).toBe('John');
    expect(userService.getUser).toHaveBeenCalledWith(1);
  });
});
```

## API

### `createMock<T>(partial?, options?)`

Creates a deeply mocked object of type `T`.

#### Parameters

- **`partial`** (optional): A partial implementation of the type to mock
  - Type: `PartialFuncReturn<T>`
  - Default: `{}`
  - Only provide the properties/methods you want to explicitly mock

- **`options`** (optional): Configuration options
  - Type: `MockOptions`
  - Properties:
    - `name?: string` - Name for the mock (useful for debugging), default: `'mock'`
    - `strict?: boolean` - Enable strict mode, default: `false`

#### Returns

A `DeepMocked<T>` object where all methods are Vitest mocks and all properties are accessible.

### Types

#### `DeepMocked<T>`

Recursively transforms a type so that all methods become Vitest mocks while preserving type information.

```typescript
type DeepMocked<T> = {
  [K in keyof T]: Required<T>[K] extends (...args: any[]) => infer U
    ? Mock<Required<T>[K]> & ((...args: Parameters<Required<T>[K]>) => DeepMocked<U>)
    : DeepMocked<T[K]>;
} & T;
```

#### `PartialFuncReturn<T>`

Allows partial mocking of an object's methods while maintaining type safety.

#### `MockOptions`

Configuration options for `createMock`:

```typescript
type MockOptions = {
  name?: string;
  strict?: boolean;
};
```

## Usage Examples

### Basic Mocking

```typescript
interface Calculator {
  add: (a: number, b: number) => number;
  subtract: (a: number, b: number) => number;
}

const calc = createMock<Calculator>({
  add: (a, b) => a + b,
});

expect(calc.add(2, 3)).toBe(5);
expect(calc.add).toHaveBeenCalledWith(2, 3);
```

### Auto-Mocking

Properties and methods not provided are automatically mocked:

```typescript
interface Service {
  method1: () => string;
  method2: () => number;
}

const service = createMock<Service>(); // No partial provided

service.method1(); // Automatically mocked
service.method2(); // Automatically mocked

expect(service.method1).toHaveBeenCalled();
expect(service.method2).toHaveBeenCalled();
```

### Deep Nested Mocking

```typescript
interface ExecutionContext {
  switchToHttp: () => {
    getRequest: () => Request;
    getResponse: () => Response;
  };
}

const context = createMock<ExecutionContext>({
  switchToHttp: () => ({
    getRequest: () => ({ headers: { authorization: 'Bearer token' } }),
  }),
});

const request = context.switchToHttp().getRequest();
expect(request.headers.authorization).toBe('Bearer token');
```

### Using Mock Methods

Since all methods are Vitest mocks, you can use all Vitest mock features:

```typescript
interface DataService {
  fetchData: () => Promise<string>;
}

const service = createMock<DataService>();

// Mock implementation
service.fetchData.mockResolvedValueOnce('first call');
service.fetchData.mockResolvedValueOnce('second call');

expect(await service.fetchData()).toBe('first call');
expect(await service.fetchData()).toBe('second call');

// Verify calls
expect(service.fetchData).toHaveBeenCalledTimes(2);
```

### Mocking Classes

```typescript
class UserRepository {
  findById(id: number): User | null {
    // Implementation
  }

  save(user: User): void {
    // Implementation
  }
}

const repo = createMock<UserRepository>(undefined, { name: 'UserRepository' });

repo.findById.mockReturnValueOnce({ id: 1, name: 'Alice' });

const user = repo.findById(1);
expect(user.name).toBe('Alice');
```

### Strict Mode

Strict mode throws an error when calling methods that haven't been stubbed:

```typescript
interface Service {
  doSomething: (value: string) => boolean;
}

const service = createMock<Service>({}, { strict: true });

// This will throw an error
expect(() => service.doSomething('test')).toThrow(
  'Method mock.doSomething was called without being explicitly stubbed'
);

// Stub the method first
service.doSomething.mockReturnValue(true);
expect(service.doSomething('test')).toBe(true); // Now it works
```

### Mocking with Optional Properties

```typescript
interface Config {
  apiUrl: string;
  timeout?: number;
  retries?: number;
}

const config = createMock<Config>({
  apiUrl: 'https://api.example.com',
  timeout: undefined, // Explicitly set optional property
});

expect(config.apiUrl).toBe('https://api.example.com');
expect(config.timeout).toBeUndefined();
```

### Property Assignment

Mocked properties can be reassigned:

```typescript
const service = createMock<{ value: number }>();

service.value = 42;
expect(service.value).toBe(42);

service.value = 99;
expect(service.value).toBe(99);
```

### Chaining Mock Return Values

```typescript
interface Validator {
  validate: () => boolean;
}

const validator = createMock<Validator>();

validator.validate
  .mockReturnValueOnce(true)
  .mockReturnValueOnce(false)
  .mockReturnValueOnce(true);

expect(validator.validate()).toBe(true);
expect(validator.validate()).toBe(false);
expect(validator.validate()).toBe(true);
```

### Mocking Async Functions

```typescript
interface AsyncService {
  fetchUser: (id: number) => Promise<{ id: number; name: string }>;
}

const service = createMock<AsyncService>({
  fetchUser: async (id) => ({ id, name: 'User ' + id }),
});

const user = await service.fetchUser(123);
expect(user).toEqual({ id: 123, name: 'User 123' });
expect(service.fetchUser).toHaveBeenCalledWith(123);
```

## Comparison with Other Solutions

### vs Manual Mocking

**Manual:**
```typescript
const service = {
  method1: vi.fn(),
  method2: vi.fn(),
  nested: {
    method3: vi.fn(),
  },
} as unknown as MyService;
```

**With vitest-create-mock:**
```typescript
const service = createMock<MyService>();
```

The API is intentionally identical to make migration seamless.

## How It Works

`vitest-create-mock` uses JavaScript Proxies to:

1. Intercept property access on the mocked object
2. Return Vitest mocks (`vi.fn()`) for methods
3. Recursively create nested proxies for deep mocking
4. Cache created mocks for consistent behavior
5. Allow property assignment and mock configuration

This approach provides a powerful, flexible mocking solution with minimal boilerplate.

## TypeScript Support

This library is written in TypeScript and provides full type safety:

- Type inference for mocked methods
- Autocomplete for all properties and methods
- Type checking for partial implementations
- Proper typing for nested objects and return values

## Development

### Prerequisites

- Node.js
- pnpm

### Commands

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run tests in watch mode
pnpm run dev

# Build the library
pnpm run build

# Type check
pnpm run typecheck
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © [Jake Klassen](https://github.com/jakeklassen)

## Credits

This library is a port of the excellent [`@golevelup/ts-jest`](https://github.com/golevelup/nestjs/tree/master/packages/testing/ts-jest) library for Vitest. Thanks to the original authors for their work!

## Related Projects

- [Vitest](https://vitest.dev/) - Next generation testing framework
- [@golevelup/ts-jest](https://github.com/golevelup/nestjs/tree/master/packages/testing/ts-jest) - The original Jest version
