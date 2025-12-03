import type { Mock } from 'vitest';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createMock } from './mocks';

interface TestInterface {
	someNum: number;
	someBool: boolean;
	optional: string | undefined;
	func: (num: number, str: string) => boolean;
	func2: (entity: TestClass) => void;
	func3: () => Promise<{ prop: number }>;
	nested: {
		someOtherNum: number;
		func4: () => boolean;
	};
}

class TestClass {
	someProperty!: number;

	nested = new NestedTestClass();

	someMethod() {
		return 42;
	}
}

class NestedTestClass {
	someOtherMethod() {
		return 24;
	}
}

describe('Mocks', () => {
	const request = {
		headers: {
			authorization: 'auth',
		},
	};

	describe('passing mocks', () => {
		it('should accept already mocked objects', () => {
			interface HttpArgumentsHost {
				getRequest: () => typeof request | null;
			}

			interface ExecutionContext {
				switchToHttp: () => HttpArgumentsHost;
			}

			// Create a mock of the return value (object type)
			const httpMock = createMock<HttpArgumentsHost>({
				getRequest: () => request,
			});

			// Pass it as the return value of a function
			const mock = createMock<ExecutionContext>({
				switchToHttp: () => httpMock,
			});

			const result = mock.switchToHttp().getRequest();

			expect(result).toBe(request);
			expect(mock.switchToHttp).toHaveBeenCalledTimes(1);
			expect(httpMock.getRequest).toHaveBeenCalledTimes(1);
		});

		it('should accept vi.fn() mocks passed directly as properties', () => {
			interface Service {
				execute: (value: number) => string;
			}

			// Create a vi.fn() mock directly
			const mockFn = vi
				.fn<(value: number) => string>()
				.mockReturnValue('mocked result');

			// Pass the mock function directly as a property
			const service = createMock<Service>({
				execute: mockFn,
			});

			const result = service.execute(42);

			expect(result).toBe('mocked result');
			expect(service.execute).toBe(mockFn); // Should be the same function, not double-wrapped
			expect(mockFn).toHaveBeenCalledTimes(1);
			expect(mockFn).toHaveBeenCalledWith(42);
		});
	});

	describe('user provided', () => {
		it('should convert user provided test object to mocks', () => {
			const request = {
				headers: {
					authorization: 'auth',
				},
			};

			interface ExecutionContext {
				switchToHttp: () => {
					getRequest: () => typeof request;
				};
			}

			const mock = createMock<ExecutionContext>({
				switchToHttp: () => ({
					getRequest: () => request,
				}),
			});

			const result = mock.switchToHttp().getRequest();

			expect(result).toBe(request);
			expect(mock.switchToHttp).toHaveBeenCalledTimes(1);
		});

		it('should work with truthy values properties', () => {
			const mock = createMock<TestInterface>({
				someNum: 1,
				someBool: true,
			});

			expect(mock.someNum).toBe(1);
			expect(mock.someBool).toBe(true);
		});

		it('should work with falsy values properties', () => {
			const mock = createMock<TestInterface>({
				someNum: 0,
				someBool: false,
			});

			expect(mock.someNum).toBe(0);
			expect(mock.someBool).toBe(false);
		});

		it('should work with optional values explicitly returning undefined', () => {
			const mock = createMock<TestInterface>({
				optional: undefined,
			});

			expect(mock.optional).toBe(undefined);
		});

		it('should work with properties and functions', () => {
			const mock = createMock<TestInterface>({
				someNum: 42,
				func: () => false,
			});

			const num = mock.someNum;
			expect(num).toBe(42);

			const funcResult = mock.func(42, '42');
			expect(funcResult).toBe(false);
			expect(mock.func).toHaveBeenCalledTimes(1);
			expect(mock.func).toHaveBeenCalledWith(42, '42');
		});

		it('should allow mocked properties to be reassigned', () => {
			const mock = createMock<TestInterface>();

			mock.someNum = 42;
			expect(mock.someNum).toBe(42);

			mock.someNum = 43;
			expect(mock.someNum).toBe(43);
		});

		it('should match mocked instances', () => {
			const mock = createMock<TestInterface>();
			const mockedInstance = createMock<TestClass>({ someProperty: 42 });

			mock.func2(mockedInstance);
			expect(mock.func2).toHaveBeenCalledWith(mockedInstance);

			expect(mock.func2).not.toHaveBeenCalledWith(42);
			expect(mock.func2).not.toHaveBeenCalledWith('42');
			expect(mock.func2).not.toHaveBeenCalledWith(true);
		});

		it('should work with classes', () => {
			const mock = createMock<TestClass>(undefined, { name: 'TestClass' });

			mock.someMethod.mockReturnValueOnce(42);

			const result = mock.someMethod();
			expect(result).toBe(42);
		});

		it('should work with partial objects and potentially undefined methods', () => {
			type TypeWithOptionalProps = {
				maybe?: () => number;
				another: () => boolean;
			};

			const mock = createMock<TypeWithOptionalProps>();
			mock.maybe?.mockImplementationOnce(() => 42);

			const result = mock.maybe?.();

			expect(result).toBe(42);
		});

		it('should work with promises', async () => {
			type TypeWithPromiseReturningFunctions = {
				doSomethingAsync: () => Promise<number>;
			};

			const mock = createMock<TypeWithPromiseReturningFunctions>({
				doSomethingAsync: async () => 42,
			});

			const result = await mock.doSomethingAsync();
			expect(result).toBe(42);
			expect(mock.doSomethingAsync).toHaveBeenCalledTimes(1);
		});

		it('should work with unknown properties', () => {
			class Base {
				field?: unknown;
			}

			class Test {
				get base(): Base {
					// biome-ignore lint/suspicious/noExplicitAny: as any to satisfy Base return type
					return undefined as any;
				}
			}

			const base = createMock<Base>();
			const test = createMock<Test>({
				base,
			});

			expect(test.base).toEqual(base);
		});

		it('should accept mocks returning nullables', async () => {
			interface Test {
				foo(): number | undefined;
			}

			const mock = createMock<Test>();
			mock.foo.mockImplementation(() => {
				return 0;
			});
			expect(mock.foo()).toEqual(0);
			mock.foo.mockImplementation(() => {
				return undefined;
			});
			expect(mock.foo()).toEqual(undefined);
		});

		it('should accept nullable values using mockReturnValueOnce and allow for chaining', async () => {
			interface Test {
				foo(): boolean;
			}
			const serviceMock = createMock<Test>();
			serviceMock.foo
				.mockReturnValueOnce(true)
				.mockReturnValueOnce(false)
				.mockReturnValueOnce(true);

			expect(serviceMock.foo()).toEqual(true);
			expect(serviceMock.foo()).toEqual(false);
			expect(serviceMock.foo()).toEqual(true);
		});

		it('should work with nested properties and functions', () => {
			const mock = createMock<TestInterface>();
			mock.nested.someOtherNum = 99;
			mock.nested.func4.mockReturnValueOnce(true);
			const result = mock.nested.func4();
			expect(mock.nested.someOtherNum).toBe(99);
			expect(result).toBe(true);
		});

		it('should work with classes having nested properties', () => {
			const mock = createMock<TestClass>();
			mock.nested.someOtherMethod.mockReturnValueOnce(99);
			const result = mock.nested.someOtherMethod();
			expect(result).toBe(99);
		});
	});

	describe('auto mocked', () => {
		it('should auto mock functions that are not provided by user', () => {
			interface ExecutionContext {
				switchToHttp: () => {
					getRequest: () => typeof request;
				};
				switchToRpc: () => {
					getContext: () => unknown;
				};
				switchToWs: () => {
					getClient: () => unknown;
				};
			}

			const mock = createMock<ExecutionContext>({
				switchToHttp: () => ({
					getRequest: () => request,
				}),
			});

			const first = mock.switchToRpc();
			const second = mock.switchToRpc();
			const third = mock.switchToWs();

			expect(mock.switchToRpc).toHaveBeenCalledTimes(2);
			expect(mock.switchToWs).toHaveBeenCalledTimes(1);
			expect(first.getContext).toBeDefined();
			expect(second.getContext).toBeDefined();
			expect(third.getClient).toBeDefined();
		});

		it('toString should work', () => {
			const mock = createMock<Record<string, unknown>>();
			expect(mock.toString()).toEqual('[object Object]');
			expect(mock.nested.toString()).toEqual('function () { [native code] }');
		});

		it('nested properties should equal its partial', () => {
			const mock = createMock<Record<string, unknown>>({ foo: { bar: 1 } });
			expect({ mock }).toEqual({ mock: { foo: { bar: 1 } } });
			expect({ foo: mock.foo }).toEqual({ foo: { bar: 1 } });
		});

		it('nested properties cannot be implicitly casted to string/number', () => {
			// biome-ignore lint/suspicious/noExplicitAny: to avoid error on > operator
			const mock = createMock<{ nested: any }>();

			const testFnNumber = () => mock.nested > 0;
			const testFnString = () => `${mock.nested}`;

			expect(testFnNumber).toThrow(Error);
			expect(testFnString).toThrow(Error);
		});

		it('mocked functions returned values can not be implictly casted to string/number', async () => {
			const mock = createMock<TestInterface>();
			const result = await mock.func3();

			const testFnNumber = () => result.prop > 0;
			const testFnString = () => `${result.prop}`;

			expect(testFnNumber).toThrow(Error);
			expect(testFnString).toThrow(Error);
		});

		it('asymmetricMatch should not be set', () => {
			// biome-ignore lint/suspicious/noExplicitAny: looseness needed for .nested property
			const mock = createMock<Record<string, any>>();
			expect(mock.asymmetricMatch).toBeUndefined();
			expect(mock.nested.asymmetricMatch).toBeUndefined();
		});

		it('nested properties mocks should be able to set properties and override cache', () => {
			// biome-ignore lint/suspicious/noExplicitAny: looseness needed for .nested property
			const mock = createMock<Record<string, any>>();
			const autoMockedFn = mock.nested.f;
			expect(typeof autoMockedFn).toEqual('function');
			const myFn = () => 5;
			mock.nested.f = myFn;
			expect(mock.nested.f === myFn).toBeTruthy();
		});

		it('should allow for mock implementation on automocked properties', () => {
			interface ExecutionContext {
				switchToHttp: () => HttpArgumentsHost;
			}

			interface HttpArgumentsHost {
				getRequest: () => typeof request;
			}

			const executionContextMock = createMock<ExecutionContext>();
			const httpArgsHost = createMock<HttpArgumentsHost>({
				getRequest: () => request,
			});

			executionContextMock.switchToHttp.mockImplementation(() => httpArgsHost);

			const result = executionContextMock.switchToHttp().getRequest();
			expect(result).toBe(request);
			expect(httpArgsHost.getRequest).toHaveBeenCalledTimes(1);
		});

		it('should automock promises so that they are awaitable', async () => {
			type TypeWithPromiseReturningFunctions = {
				doSomethingAsync: () => Promise<number>;
			};

			const mock = createMock<TypeWithPromiseReturningFunctions>();

			const result = await mock.doSomethingAsync();
			expect(result).toBeDefined();
			expect(mock.doSomethingAsync).toHaveBeenCalledTimes(1);
		});

		it('should automock objects returned from automocks', () => {
			interface ExecutionContext {
				switchToHttp: () => {
					getRequest: () => typeof request;
				};
			}

			const mock = createMock<ExecutionContext>();

			mock.switchToHttp().getRequest.mockImplementation(() => request);

			const request1 = mock.switchToHttp().getRequest();
			const request2 = mock.switchToHttp().getRequest();
			expect(request1).toBe(request);
			expect(request2).toBe(request);

			expect(mock.switchToHttp).toHaveBeenCalledTimes(3);
			expect(mock.switchToHttp().getRequest).toHaveBeenCalledTimes(2);
		});

		it('should automock objects returned from automocks recursively', () => {
			interface One {
				getNumber: () => number;
			}

			interface Two {
				getOne: () => One;
			}

			interface Three {
				getTwo: () => Two;
			}

			const mock = createMock<Three>();

			mock.getTwo().getOne().getNumber.mockReturnValueOnce(42);

			const result = mock.getTwo().getOne().getNumber();

			expect(result).toBe(42);
		});

		describe('constructor', () => {
			it('should have constructor defined', () => {
				class Service {}

				const mock = createMock<Service>();

				expect(mock.constructor).toBeDefined();
			});

			it('should have the same constructor defined', () => {
				class Service {}

				const mock = createMock<Service>();

				expect(mock.constructor).toEqual(mock.constructor);
			});

			it('should allow mocks to be equal', () => {
				class Service {}

				const comparable = createMock<Service>();

				expect([comparable]).toEqual([comparable]);
			});
		});

		describe('strict mode', () => {
			it('should throw error when calling unstubbed method in strict mode', () => {
				const mock = createMock<TestInterface>({}, { strict: true });

				expect(() => mock.func(1, 'test')).toThrow(
					'Method mock.func was called without being explicitly stubbed',
				);

				mock.func.mockReturnValue(true);
				expect(mock.func(1, 'test')).toBe(true);
			});
		});
	});

	describe('type inference', () => {
		it('should properly type mocked functions with DeepMocked return values', () => {
			interface ExecutionContext {
				switchToHttp: () => {
					getRequest: () => { headers: { authorization: string } };
				};
			}

			const mock = createMock<ExecutionContext>();

			// Test that switchToHttp() returns a properly typed DeepMocked object
			const httpContext = mock.switchToHttp();
			expectTypeOf(httpContext).toExtend<
				ReturnType<ExecutionContext['switchToHttp']>
			>();
			expectTypeOf(httpContext).toHaveProperty('getRequest');

			// Test that getRequest is a Mock function
			expectTypeOf(httpContext.getRequest).toExtend<Mock>();
			expectTypeOf(httpContext.getRequest).toHaveProperty('mockImplementation');

			// Test that we can call mockImplementation without type errors
			expectTypeOf(httpContext.getRequest.mockImplementation).toBeFunction();
			expectTypeOf(httpContext.getRequest.mockReturnValue).toBeFunction();
		});

		it('should properly type nested mocked function calls', () => {
			interface One {
				getNumber: () => number;
			}

			interface Two {
				getOne: () => One;
			}

			interface Three {
				getTwo: () => Two;
			}

			const mock = createMock<Three>();

			// Test nested calls are properly typed
			const two = mock.getTwo();
			expectTypeOf(two).toExtend<Two>();
			expectTypeOf(two).toHaveProperty('getOne');

			const one = two.getOne();
			expectTypeOf(one).toExtend<One>();
			expectTypeOf(one).toHaveProperty('getNumber');

			// Test getNumber is a Mock
			expectTypeOf(one.getNumber).toExtend<Mock>();
			expectTypeOf(one.getNumber).toHaveProperty('mockReturnValueOnce');

			// Test that chained access works
			expectTypeOf(mock.getTwo().getOne().getNumber).toExtend<Mock>();
		});

		it('should properly type optional functions', () => {
			interface TypeWithOptionalFunction {
				maybe?: () => number;
				required: () => string;
			}

			const mock = createMock<TypeWithOptionalFunction>();

			// Optional function should have mockReturnValueOnce when present
			if (mock.maybe) {
				expectTypeOf(mock.maybe).toExtend<Mock>();
				expectTypeOf(mock.maybe).toHaveProperty('mockReturnValueOnce');
			}

			// Required function should be a Mock
			expectTypeOf(mock.required).toExtend<Mock>();
			expectTypeOf(mock.required).toHaveProperty('mockReturnValue');
		});

		it('should properly type Record<string, unknown>', () => {
			const mock = createMock<Record<string, unknown>>();

			// Properties should be any (for proxy support)
			expectTypeOf(mock.nested).toBeAny();
			expectTypeOf(mock.anything).toBeAny();
		});

		it('should preserve primitive types', () => {
			interface WithPrimitives {
				num: number;
				str: string;
				bool: boolean;
			}

			const mock = createMock<WithPrimitives>();

			// Primitives should keep their types
			expectTypeOf(mock.num).toBeNumber();
			expectTypeOf(mock.str).toBeString();
			expectTypeOf(mock.bool).toBeBoolean();
		});
	});
});
