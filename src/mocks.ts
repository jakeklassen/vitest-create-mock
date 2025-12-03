import type { Mock } from 'vitest';
import { vi } from 'vitest';

/**
 * Recursively makes all properties of a type optional and applies the same transformation
 * to nested objects. Arrays are preserved but their elements are made deeply partial.
 * Unknown types are left as-is since we can't make assumptions about their structure.
 */
type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends Array<infer U>
		? Array<DeepPartial<U>>
		: T[P] extends ReadonlyArray<infer U>
			? ReadonlyArray<DeepPartial<U>>
			: unknown extends T[P]
				? T[P]
				: DeepPartial<T[P]>;
};

/**
 * Type for the partial object passed to createMock. All properties are optional.
 * - Functions can be provided as implementations OR as already-mocked DeepMocked functions
 *   (enabling mock composition - passing pre-built mocks to other mocks)
 * - Non-function properties can be partial values OR already-mocked DeepMocked objects
 * This dual support prevents double-wrapping and allows flexible mock composition.
 */
export type PartialFuncReturn<T> = {
	[K in keyof T]?: T[K] extends (...args: infer A) => infer U
		? ((...args: A) => PartialFuncReturn<U>) | DeepMocked<T[K]>
		: DeepPartial<T[K]> | DeepMocked<T[K]>;
};

/**
 * Helper to detect if a type is exactly `unknown` (not `any` or other types).
 *
 * Logic breakdown:
 * - `unknown extends T` is true for both `unknown` and `any`
 * - `T extends {}` is true for `any` but false for `unknown`
 * - Therefore: if `unknown extends T` is true AND `T extends {}` is false, then T is `unknown`
 *
 * This is needed because Record<string, unknown> properties should become `any` for
 * proxy support, while concrete types should maintain their proper types.
 */
// biome-ignore lint/complexity/noBannedTypes: {} intentionally used to detect unknown type
type IsUnknown<T> = unknown extends T ? (T extends {} ? false : true) : false;

/**
 * Helper type for mocked functions with deep mocked return types.
 * Wraps a function so that:
 * - It maintains the same parameters as the original function
 * - Its return type is deeply mocked (enabling chained mock access like `mock.getUser().getName()`)
 * - It includes all Vitest Mock methods (mockImplementation, mockReturnValue, etc.)
 */
// biome-ignore lint/suspicious/noExplicitAny: generic constraint for any function signature
type MockedFunction<T extends (...args: any[]) => any> = ((
	...args: Parameters<T>
) => DeepMocked<ReturnType<T>>) &
	Mock<T>;

/**
 * Recursively transforms a type into a deeply mocked version.
 * Each property is handled based on its type:
 *
 * 1. Unknown types (e.g., Record<string, unknown>):
 *    - Become `any` to support dynamic proxy access
 *    - Enables `mock.anything.nested.deeply` without type errors
 *
 * 2. Functions:
 *    - Wrapped with MockedFunction to provide Mock methods
 *    - Return types are recursively DeepMocked
 *    - Optional functions preserve their optionality (union with undefined)
 *    - Example: `mock.getUser()` returns DeepMocked<User> with all Mock methods
 *
 * 3. Objects:
 *    - Recursively transformed to DeepMocked
 *    - Optional objects preserve their optionality
 *    - Example: `mock.nested.property` is also deeply mocked
 *
 * 4. Primitives (string, number, boolean, etc.):
 *    - Left as-is since they can't have nested properties
 */
export type DeepMocked<T> = {
	[K in keyof T]: IsUnknown<T[K]> extends true
		? // biome-ignore lint/suspicious/noExplicitAny: unknown types become any for proxy support
			any
		: // biome-ignore lint/suspicious/noExplicitAny: generic constraint for any function signature
			NonNullable<T[K]> extends (...args: any[]) => any
			? undefined extends T[K]
				? MockedFunction<NonNullable<T[K]>> | undefined // optional function
				: MockedFunction<NonNullable<T[K]>> // required function
			: NonNullable<T[K]> extends object
				? undefined extends T[K]
					? DeepMocked<NonNullable<T[K]>> | undefined // optional object
					: DeepMocked<T[K]> // required object
				: T[K]; // primitive
};

/**
 * Set of property names that are part of Vitest's Mock API.
 * These properties should be accessed directly from the underlying vi.fn() mock
 * rather than being proxied, to ensure proper Mock behavior.
 * This prevents our proxy from intercepting these special properties.
 */
const vitestFnProps = new Set([
	'getMockName',
	'mock',
	'mockClear',
	'mockImplementation',
	'mockImplementationOnce',
	'mockName',
	'mockRejectedValue',
	'mockRejectedValueOnce',
	'mockReset',
	'mockResolvedValue',
	'mockResolvedValueOnce',
	'mockRestore',
	'mockReturnThis',
	'mockReturnValue',
	'mockReturnValueOnce',
	'withImplementation',
	'calls',
]);

/**
 * Creates a Proxy that enables deep mocking with automatic property generation.
 *
 * @param name - Debug name for the mock (used in error messages)
 * @param strict - If true, throws errors when calling unstubbed methods
 * @param base - Optional base object with pre-defined properties/implementations
 * @returns A proxied object that auto-generates mocks for any accessed property
 */
const createProxy: {
	<T extends object>(name: string, strict: boolean, base: T): T;
	<T extends Mock = Mock>(name: string, strict: boolean): T;
} = <T extends object | Mock>(name: string, strict: boolean, base?: T): T => {
	// biome-ignore lint/suspicious/noExplicitAny: looseness needed for mocking
	const cache = new Map<string | number | symbol, any>();

	const handler: ProxyHandler<T> = {
		get: (obj, prop, receiver) => {
			const propName = prop.toString();

			// Return undefined for special properties to prevent interference:
			// - 'inspect' & Symbol(util.inspect.custom): Node.js inspection (console.log)
			// - 'then': Prevents mocks from being treated as Promises
			// - 'asymmetricMatch': Prevents interference with Vitest's asymmetric matchers
			if (
				prop === 'inspect' ||
				prop === 'then' ||
				prop === 'asymmetricMatch' ||
				(typeof prop === 'symbol' && propName === 'Symbol(util.inspect.custom)')
			) {
				return undefined;
			}

			// For auto-mocked functions (no base), allow direct access to Vitest Mock API properties
			// This ensures methods like mockImplementation work correctly
			if (!base && vitestFnProps.has(propName)) {
				return Reflect.get(obj, prop, receiver);
			}

			// Return cached value if we've already created a mock for this property
			// Ensures consistency: accessing mock.foo twice returns the same mock
			if (cache.has(prop)) {
				return cache.get(prop);
			}

			// biome-ignore lint/suspicious/noExplicitAny: looseness needed for mocking
			const checkProp = (obj as any)[prop];

			// biome-ignore lint/suspicious/noExplicitAny: looseness needed for mocking
			let mockedProp: any;

			if (prop in obj) {
				// Property exists in the base object
				// Check for functions - don't double-wrap already mocked functions
				if (typeof checkProp === 'function') {
					// If it's already a vi.fn() mock (from mock composition), use it as-is
					// Otherwise wrap it with vi.fn() to track calls
					mockedProp = vi.isMockFunction(checkProp)
						? checkProp
						: vi.fn(checkProp);
				} else {
					// Non-function property, use the value directly
					mockedProp = checkProp;
				}
			} else {
				// Property doesn't exist - auto-generate a nested mock
				// This enables deep access like mock.nested.deeply.whatever
				mockedProp = createProxy(`${name}.${propName}`, strict);
			}

			// Cache the mocked property for consistent return values
			cache.set(prop, mockedProp);

			return mockedProp;
		},
		set: (obj, prop, newValue) => {
			// Update both the cache and the underlying object
			// This allows mock properties to be reassigned: mock.foo = 42
			cache.set(prop, newValue);

			return Reflect.set(obj, prop, newValue);
		},
	};

	// For auto-mocked functions (no base), add apply trap to handle function calls
	if (!base) {
		(handler as ProxyHandler<Mock>).apply = (target, thisArg, argsArray) => {
			const result = Reflect.apply(target, thisArg, argsArray);

			// If the function has a user-provided implementation or returned a value, use it
			if (target.getMockImplementation() || result !== undefined) {
				return result;
			}

			// Strict mode: throw error if function is called without being stubbed
			if (strict) {
				throw new Error(
					`Method ${name} was called without being explicitly stubbed`,
				);
			}

			// Auto-generate a mock for the return value
			// Cache it so repeated calls return the same mock object
			if (!cache.has('__apply')) {
				cache.set('__apply', createProxy(name, strict));
			}

			return cache.get('__apply');
		};
	}
	return new Proxy(base || (vi.fn() as T), handler);
};

export type MockOptions = {
	/** Debug name for the mock, used in error messages (default: 'mock') */
	name?: string;
	/** If true, throws errors when calling unstubbed methods (default: false) */
	strict?: boolean;
};

/**
 * Creates a deep mock of the specified type with Vitest.
 *
 * Features:
 * - All properties and methods are automatically mocked
 * - Nested properties are also deeply mocked (e.g., `mock.user.address.city`)
 * - Function return values are automatically mocked and awaitable
 * - Supports mock composition: pass existing mocks as partial values
 * - All functions are Vitest mocks with full Mock API support
 *
 * @param partial - Optional object with pre-defined properties/implementations
 * @param options - Optional configuration (name, strict mode)
 * @returns A deeply mocked version of T with all Mock methods available
 *
 * @example
 * ```typescript
 * interface User {
 *   getName: () => string;
 *   getAddress: () => { city: string };
 * }
 *
 * // Auto-mocked
 * const user = createMock<User>();
 * user.getName.mockReturnValue('John');
 * user.getAddress().city; // Automatically mocked
 *
 * // With partial implementation
 * const user = createMock<User>({
 *   getName: () => 'John'
 * });
 *
 * // Mock composition
 * const address = createMock<Address>({ city: 'NYC' });
 * const user = createMock<User>({
 *   getAddress: () => address
 * });
 * ```
 */
export const createMock = <T extends object>(
	partial: PartialFuncReturn<T> = {},
	options: MockOptions = {},
): DeepMocked<T> => {
	const { name = 'mock', strict = false } = options;
	const proxy = createProxy<T>(name, strict, partial as T);

	return proxy as DeepMocked<T>;
};
