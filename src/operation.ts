type Simplify<A> = { [K in keyof A]: A[K] } & {};

type ParametersInput<O> = O extends { parameters: infer P }
  ? { readonly parameters: P }
  : O extends { parameters?: infer P }
    ? { readonly parameters?: P }
    : {};

type BodyValue<B> = B extends { content: infer C }
  ? C extends Readonly<Record<PropertyKey, unknown>>
    ? C[keyof C]
    : never
  : never;

type BodyInput<O> = O extends { requestBody: infer B }
  ? { readonly body: BodyValue<B> }
  : O extends { requestBody?: infer B }
    ? { readonly body?: BodyValue<B> }
    : {};

type ResponseValue<R> = R extends { content: infer C }
  ? C extends Readonly<Record<PropertyKey, unknown>>
    ? C[keyof C]
    : never
  : undefined;

type SuccessfulResponses<R> = {
  [K in keyof R]: `${K & (string | number)}` extends `2${string}`
    ? ResponseValue<R[K]>
    : never;
}[keyof R];

export type OperationInput<O> = Simplify<ParametersInput<O> & BodyInput<O>>;

export type OperationOutput<O> = O extends { responses: infer R }
  ? SuccessfulResponses<R>
  : unknown;

export interface RuntimeOperationInput {
  readonly parameters?: {
    readonly path?: Readonly<Record<string, unknown>>;
    readonly query?: Readonly<Record<string, unknown>>;
    readonly header?: Readonly<Record<string, unknown>>;
  };
  readonly body?: unknown;
}
