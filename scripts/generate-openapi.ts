// @ts-nocheck -- the generated contract is covered by executable fixtures.
/**
 * Shared OpenAPI Code Generator
 *
 * Handles OpenAPI 2.0 (Swagger), 3.0, and 3.1 specs.
 * Generates Protocol-based Effect TypeScript service modules with:
 * - Input schemas with Http/Label/Query/Header/Body traits
 * - Output schemas
 * - Typed error classes per operation
 * - JSDoc from spec descriptions
 *
 * Each SDK configures this generator with its own spec paths, import aliases,
 * and error handling strategy.
 *
 * @example
 * ```ts
 * import { generateFromOpenAPI } from "@kevinmichaelchen/distilled/openapi/generate";
 *
 * generateFromOpenAPI({
 *   specPath: "specs/openapi.json",
 *   patchDir: "patches",
 *   outputDir: "src/services",
 *   importPrefix: "..",
 *   protocolName: "ExampleProtocol",
 *   operationErrorType: "ExampleOpError",
 *   operationContextType: "ExampleOpContext",
 * });
 * ```
 */
import * as fs from "fs";
import * as path from "path";
import {
  applyOperation,
  isStaleTargetError,
  type PatchFile,
} from "../src/json-patch.ts";

const annotatePureExportConst = (definition: string) =>
  definition.replace(
    /^export const ([^=]+?)\s*=\s*/m,
    "export const $1 = /*@__PURE__*/ /*#__PURE__*/ ",
  );

/** Quote a property name if it's not a valid JS identifier. */
function quotePropKey(name: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : `"${name}"`;
}

// ============================================================================
// OpenAPI Types (unified across 2.0, 3.0, 3.1)
// ============================================================================

// --- Swagger 2.0 Types ---
interface Swagger2Spec {
  swagger: string;
  info: { title: string; version: string };
  basePath?: string;
  paths: Record<string, PathItem2>;
  definitions?: Record<string, SchemaObject>;
  "x-error-categories"?: Record<string, unknown>;
  "x-http-status-to-error-code"?: Record<string, string>;
}

interface PathItem2 {
  get?: Operation2;
  post?: Operation2;
  put?: Operation2;
  patch?: Operation2;
  delete?: Operation2;
  head?: Operation2;
  options?: Operation2;
  trace?: Operation2;
  // Path-level parameters shared by every operation on this path (Swagger 2.0
  // allows these, and Kubernetes puts `namespace`/`name`/`pretty` here as
  // `$ref`s). They must be merged into each operation's own parameters.
  parameters?: Parameter2[];
}

interface Operation2 {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter2[];
  responses: Record<string, Response2>;
  deprecated?: boolean;
}

interface Parameter2 {
  // A parameter may be a `$ref` into the spec's top-level `#/parameters`
  // dictionary instead of an inline definition (in which case `name`/`in` are
  // absent until resolved). Kubernetes uses this heavily.
  $ref?: string;
  name: string;
  in: "path" | "query" | "body" | "header";
  type?: string;
  required?: boolean;
  description?: string;
  default?: unknown;
  enum?: (string | number | boolean)[];
  schema?: SchemaObject;
}

interface Response2 {
  description: string;
  schema?: SchemaObject | { $ref: string };
}

// --- OpenAPI 3.x Types ---
interface OpenAPI3Spec {
  openapi: string;
  info: { title: string; version: string };
  servers?: Array<{ url: string }>;
  paths: Record<string, PathItem3>;
  components?: {
    schemas?: Record<string, SchemaObject>;
    responses?: Record<string, ResponseObject3>;
    parameters?: Record<string, ParameterObject3>;
  };
}

interface PathItem3 {
  get?: Operation3;
  post?: Operation3;
  put?: Operation3;
  patch?: Operation3;
  delete?: Operation3;
  head?: Operation3;
  options?: Operation3;
  trace?: Operation3;
  parameters?: ParameterObject3[];
}

interface Operation3 {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParameterObject3[];
  requestBody?: RequestBody3;
  responses: Record<string, ResponseObject3>;
  deprecated?: boolean;
}

interface ParameterObject3 {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
  $ref?: string;
}

interface RequestBody3 {
  required?: boolean;
  content?: Record<string, MediaType3>;
  $ref?: string;
}

interface ResponseObject3 {
  description: string;
  content?: Record<string, MediaType3>;
  $ref?: string;
}

interface MediaType3 {
  schema?: SchemaObject;
}

// --- Shared Schema Object ---
interface SchemaObject {
  type?: string | string[]; // string[] for OAS 3.1 nullable syntax
  $ref?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  enum?: (string | number | boolean)[];
  additionalProperties?: boolean | SchemaObject;
  description?: string;
  default?: unknown;
  nullable?: boolean; // OAS 3.0
  "x-nullable"?: boolean; // Swagger 2.0
  "x-sensitive"?: boolean;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  format?: string;
  minimum?: number;
  maximum?: number;
}

// ============================================================================
// Generator Configuration
// ============================================================================

export interface GeneratorConfig {
  /** Path to the OpenAPI spec file */
  specPath: string;
  /** Directory containing *.patch.json files (can be same as spec dir or separate) */
  patchDir: string;
  /** Output directory for generated files */
  outputDir: string;
  /** Import prefix for relative imports (e.g., ".." for services/ -> src/) */
  importPrefix: string;
  /** Shared API runtime import. */
  apiImport?: string;
  /** Shared lightweight schema import. */
  schemaImport?: string;
  /** Provider traits import path (usually `../traits`). */
  traitsImport?: string;
  /** Provider protocol import path (usually `../protocol`). */
  protocolImport?: string;
  /** Protocol layer exported by `protocolImport`. */
  protocolName: string;
  /** Optional protocol layer used by generated paginated operations. */
  paginatedProtocolName?: string;
  /** Provider-wide operation error union exported by `protocolImport`. */
  operationErrorType: string;
  /** Provider-wide operation context exported by `protocolImport`. */
  operationContextType: string;
  /** Provider retry module import path (usually `../retry`). */
  retryImport?: string;
  /** Retry tag expression. Defaults to `Retry.Retry`. */
  retryTag?: string;
  /**
   * HTTP methods that opt into automatic retry. Defaults to safe methods only:
   * GET, HEAD, OPTIONS, and TRACE.
   */
  retryMethods?: readonly UppercaseHttpMethod[];
  /** Errors import path (for operation-specific error imports) */
  errorsImport?: string;
  /** Whether to include operation-specific error imports (default: true for Swagger, false for OAS 3.x) */
  includeOperationErrors?: boolean;
  /** Status codes to error class name mapping (only used when includeOperationErrors=true) */
  statusToErrorClass?: Record<string, string>;
  /** Default error status codes to exclude from operation-specific errors */
  defaultErrorStatuses?: Set<string>;
  /** Whether to skip deprecated operations (default: true) */
  skipDeprecated?: boolean;
}

const OPENAPI_HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
] as const;

type OpenAPIHttpMethod = (typeof OPENAPI_HTTP_METHODS)[number];
export type UppercaseHttpMethod = Uppercase<OpenAPIHttpMethod>;

export interface GenerationCoverage {
  readonly schemaVersion: 1;
  readonly spec: {
    readonly format: SpecVersion;
    readonly title: string;
    readonly version: string;
  };
  readonly configuration: {
    readonly skipDeprecated: boolean;
  };
  readonly patches: {
    readonly applied: readonly string[];
    readonly skipped: readonly string[];
  };
  readonly operations: {
    readonly total: number;
    readonly deprecated: number;
    readonly skippedDeprecated: number;
    readonly attempted: number;
    readonly generated: number;
    readonly failed: number;
    readonly unsupported: number;
    readonly byMethod: Record<
      UppercaseHttpMethod,
      {
        readonly total: number;
        readonly deprecated: number;
        readonly skippedDeprecated: number;
        readonly attempted: number;
        readonly generated: number;
        readonly failed: number;
      }
    >;
  };
}

export class OpenAPIGenerationError extends AggregateError {
  readonly coverage: GenerationCoverage;

  constructor(errors: readonly Error[], coverage: GenerationCoverage) {
    super(
      errors,
      `OpenAPI generation failed for ${errors.length} operation${errors.length === 1 ? "" : "s"}`,
    );
    this.name = "OpenAPIGenerationError";
    this.coverage = coverage;
  }
}

function applyAllPatches(
  spec: unknown,
  patchDir: string,
): {
  applied: string[];
  skipped: string[];
  errors: string[];
} {
  if (!fs.existsSync(patchDir)) return { applied: [], skipped: [], errors: [] };
  const applied: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  for (const file of fs
    .readdirSync(patchDir)
    .filter((name) => name.endsWith(".patch.json"))
    .sort()) {
    let patch: PatchFile;
    try {
      patch = JSON.parse(
        fs.readFileSync(path.join(patchDir, file), "utf8"),
      ) as PatchFile;
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    let changed = false;
    for (const [index, operation] of patch.patches.entries()) {
      try {
        applyOperation(spec, operation);
        changed = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const detail = `${file}#${index + 1}: ${message}`;
        if (isStaleTargetError(message)) skipped.push(detail);
        else errors.push(detail);
      }
    }
    if (changed) applied.push(file);
  }
  return { applied, skipped, errors };
}

// ============================================================================
// Utility Functions
// ============================================================================

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toCamelCase(s: string): string {
  const camel = s
    .replace(/[-_.\s/]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9$]/g, "");
  return camel.charAt(0).toLowerCase() + camel.slice(1);
}

function toPascalCase(s: string): string {
  return capitalize(toCamelCase(s));
}

function toSnakeCase(s: string): string {
  const snake = s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (!snake) return "service";
  return /^[0-9]/.test(snake) ? `service_${snake}` : snake;
}

function resolveServiceName(
  tags: readonly string[] | undefined,
  pathTemplate: string,
): string {
  const primaryTag = tags?.find((tag) => tag.trim().length > 0);
  if (primaryTag) return toSnakeCase(primaryTag);
  const segment = pathTemplate
    .split("/")
    .filter(Boolean)
    .find(
      (part) =>
        !part.startsWith("{") &&
        !/^(?:api|rest|v\d+(?:\.\d+)?)$/i.test(part),
    );
  return toSnakeCase(segment ?? "service");
}

function operationIdToFunctionName(operationId: string): string {
  return toCamelCase(operationId);
}

function renderHttpMethod(method: OpenAPIHttpMethod): string {
  return `"${method.toUpperCase()}"`;
}

function resolveOperationId(
  operation: { operationId?: string; summary?: string; tags?: string[] },
  method: string,
  pathTemplate: string,
  usedFunctionNames: Set<string>,
): string {
  const explicit = operation.operationId?.trim();
  const label = explicit || [operation.tags?.[0], operation.summary].filter(Boolean).join(" ");
  const fallback = label || `${method} ${pathTemplate}`;
  let operationId = fallback;
  let functionName = operationIdToFunctionName(operationId);

  if (!explicit && usedFunctionNames.has(functionName)) {
    operationId = `${fallback} ${method} ${pathTemplate}`;
    functionName = operationIdToFunctionName(operationId);
  }
  if (!functionName || usedFunctionNames.has(functionName)) {
    throw new Error(
      `OpenAPI operation name collision for ${method.toUpperCase()} ${pathTemplate}: ${JSON.stringify(operationId)}`,
    );
  }

  usedFunctionNames.add(functionName);
  return operationId;
}

function escapeStringLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/`/g, "\\`");
}

function renderEnumLiterals(
  values: readonly (string | number | boolean)[],
  type: string | undefined,
): string {
  const isNumeric = type === "integer" || type === "number";
  const isBoolean = type === "boolean";
  const literals = values
    .map((v) =>
      isBoolean || isNumeric
        ? String(v)
        : `"${escapeStringLiteral(String(v))}"`,
    )
    .join(", ");
  return `S.Literals([${literals}])`;
}

function renderParameterSchema3(
  schema: SchemaObject | undefined,
  spec: OpenAPI3Spec,
  ctx: SchemaGenerationContext,
): string {
  if (!schema) return "S.String";
  if (schema.enum && schema.enum.length > 0) {
    return renderEnumLiterals(schema.enum, schema.type);
  }
  return openApiTypeToEffectSchema(schema, spec, "", new Set(), ctx);
}

// ============================================================================
// Version Detection
// ============================================================================

type SpecVersion = "2.0" | "3.0" | "3.1";

function detectVersion(spec: any): SpecVersion {
  if (spec.swagger === "2.0") return "2.0";
  if (spec.openapi?.startsWith("3.1")) return "3.1";
  if (spec.openapi?.startsWith("3.0")) return "3.0";
  throw new Error(
    `Unsupported spec version: ${spec.swagger || spec.openapi || "unknown"}`,
  );
}

// ============================================================================
// Schema Resolution (version-aware)
// ============================================================================

function resolveRef(spec: any, ref: string): SchemaObject {
  // Generic JSON Pointer resolution for #/ refs
  if (ref.startsWith("#/")) {
    const segments = ref.slice(2).split("/");
    let current: any = spec;
    for (const segment of segments) {
      current = current?.[segment];
      if (current === undefined) {
        throw new Error(`Could not resolve ref: ${ref}`);
      }
    }
    return current;
  }
  throw new Error(`Could not resolve ref: ${ref}`);
}

function resolveParameterRef(spec: any, ref: string): ParameterObject3 {
  const refPath = ref.replace("#/components/parameters/", "");
  const param = spec.components?.parameters?.[refPath];
  if (!param) throw new Error(`Could not resolve parameter ref: ${ref}`);
  return param;
}

function resolveResponseRef(spec: any, ref: string): ResponseObject3 {
  const refPath = ref.replace("#/components/responses/", "");
  const response = spec.components?.responses?.[refPath];
  if (!response) throw new Error(`Could not resolve response ref: ${ref}`);
  return response;
}

/**
 * Merge a Swagger 2.0 path's path-level parameters with an operation's own
 * parameters, resolving any `$ref` entries (e.g. `#/parameters/namespace-…`)
 * to their inline definitions via the generic JSON-pointer resolver.
 *
 * Without this, `$ref` parameters — which carry no `in`/`name` until resolved —
 * are silently dropped by the downstream `p.in === "path"|"query"` filters, so
 * generated inputs omit path params (`namespace`/`name`) and ref'd query params
 * (`fieldManager`/`force`/`pretty`). Mirrors {@link resolveParameters3} for the
 * 2.0 codepath.
 */
function resolveParameters2(
  spec: Swagger2Spec,
  pathParams: Parameter2[] | undefined,
  operationParams: Parameter2[] | undefined,
): Parameter2[] {
  const params: Parameter2[] = [];
  const add = (param: Parameter2) => {
    params.push(
      param.$ref
        ? (resolveRef(spec as any, param.$ref) as unknown as Parameter2)
        : param,
    );
  };
  if (pathParams) for (const param of pathParams) add(param);
  if (operationParams) for (const param of operationParams) add(param);
  return params;
}

function isNullable(prop: SchemaObject): boolean {
  // OAS 3.1: type can be ["string", "null"]
  if (Array.isArray(prop.type) && prop.type.includes("null")) return true;
  // OAS 3.0: nullable: true
  if (prop.nullable) return true;
  // Swagger 2.0: x-nullable: true
  if (prop["x-nullable"]) return true;
  return false;
}

function getBaseType(prop: SchemaObject): string | undefined {
  if (Array.isArray(prop.type)) {
    return prop.type.find((t) => t !== "null");
  }
  return prop.type;
}

/**
 * Guards against combinatorial blow-up when inlining `oneOf`/`anyOf` unions.
 * Large recursive union graphs (e.g. PostHog's HogQL query AST) otherwise
 * expand into hundreds of MB of generated types. A union collapses to
 * `unknown` once it nests past `MAX_UNION_INLINE_DEPTH` `$ref` hops (bounds
 * build cost) or its rendered text exceeds `MAX_UNION_INLINE_CHARS` (bounds
 * the breadth of any single union node).
 */
const MAX_UNION_INLINE_DEPTH = 4;
const MAX_UNION_INLINE_CHARS = 4000;

/**
 * Whether every branch of a `oneOf`/`anyOf` is a scalar — a primitive,
 * an enum, or a pure-null branch — with no `$ref`, nested union, object, or
 * array. Such unions (e.g. `boolean | string`, `string | number`) are tiny
 * and finite, so the `MAX_UNION_INLINE_DEPTH` cutoff (which exists to bound
 * combinatorial blow-up of recursive *object* union graphs) must not collapse
 * them to `unknown`. Collapsing a `boolean | string` leaf just because it sits
 * deep in a response tree is what dropped Axiom's `showChart`/`chartHeight`.
 */
function isScalarUnion(branches: SchemaObject[], spec: OpenAPISpec): boolean {
  return branches.every((branch) => {
    if (isNullBranch(branch, spec)) return true;
    if (branch.$ref || branch.oneOf || branch.anyOf || branch.allOf) {
      return false;
    }
    if (branch.enum && branch.enum.length > 0) return true;
    const t = branch.type;
    return (
      t === "string" || t === "number" || t === "integer" || t === "boolean"
    );
  });
}

/**
 * A `oneOf`/`anyOf` branch that contributes only nullability — an explicit
 * `{ "type": "null" }` branch or a `$ref` to a null-only enum (PostHog's
 * `NullEnum` is `{ "enum": [null] }`). Such branches collapse into a
 * `S.NullOr` / `| null` wrapper rather than becoming a union member.
 */
function isNullBranch(branch: SchemaObject, spec: any): boolean {
  let b = branch;
  if (b.$ref) {
    b = resolveRef(spec, b.$ref);
  }
  if (b.type === "null") return true;
  if (Array.isArray(b.type) && b.type.every((t) => t === "null")) return true;
  if (
    Array.isArray(b.enum) &&
    b.enum.length > 0 &&
    b.enum.every((v) => v === null)
  ) {
    return true;
  }
  return false;
}

// ============================================================================
// Redacted Field Detection
// ============================================================================

/**
 * Field name patterns that indicate sensitive data.
 * These patterns match common credential/secret field names across APIs.
 */
const SENSITIVE_FIELD_PATTERNS: RegExp[] = [
  /password/i,
  /^secret$/i,
  /secret[-_]?key/i,
  /[-_]secret$/i,
  /^client[-_]?secret$/i,
  /^access[-_]?token$/i,
  /^refresh[-_]?token$/i,
  /^api[-_]?key$/i,
  /^api[-_]?key[-_]?secret$/i,
  /^api[-_]?token$/i,
  /^private[-_]?key$/i,
  /^secret[-_]?access[-_]?key$/i,
  /^session[-_]?token$/i,
  /^access[-_]?key[-_]?id$/i,
  /^one[-_]?time[-_]?password$/i,
  /^connection[-_]?string$/i,
  /^connection[-_]?uri$/i,
  /^plain[-_]?text$/i,
  /^plain[-_]?text[-_]?refresh[-_]?token$/i,
];

/**
 * Check if a field name matches known sensitive data patterns.
 */
function isSensitiveFieldName(name: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(name));
}

// ============================================================================
// Effect Schema Generation
// ============================================================================

interface SchemaGenerationContext {
  direction?: "input" | "output";
  usesSensitiveString: boolean;
  usesSensitiveNullableString: boolean;
  usesSensitiveOutputString: boolean;
  usesSensitiveOutputNullableString: boolean;
}

function openApiTypeToEffectSchema(
  prop: SchemaObject,
  spec: any,
  indent: string = "",
  seenRefs: Set<string> = new Set(),
  ctx?: SchemaGenerationContext,
): string {
  // Handle $ref
  if (prop.$ref) {
    if (seenRefs.has(prop.$ref)) {
      return "S.Unknown"; // Prevent infinite recursion
    }
    const resolved = resolveRef(spec, prop.$ref);
    return openApiTypeToEffectSchema(
      resolved,
      spec,
      indent,
      new Set([...seenRefs, prop.$ref]),
      ctx,
    );
  }

  // Handle allOf - if it's a single entry referencing a non-object (enum,
  // scalar), resolve and pass through directly so we don't lose the type.
  // Otherwise merge object schemas.
  if (prop.allOf && prop.allOf.length > 0) {
    if (prop.allOf.length === 1) {
      let resolved = prop.allOf[0];
      if (resolved.$ref) {
        if (seenRefs.has(resolved.$ref)) return "S.Unknown";
        resolved = resolveRef(spec, resolved.$ref);
        // Recurse with the resolved schema. Carry over `description` and
        // nullability from the parent if set.
        const mergedProp: SchemaObject = {
          ...resolved,
          ...(prop.nullable !== undefined ? { nullable: prop.nullable } : {}),
          ...(prop["x-nullable"] !== undefined
            ? { "x-nullable": prop["x-nullable"] }
            : {}),
          ...(prop["x-sensitive"] !== undefined
            ? { "x-sensitive": prop["x-sensitive"] }
            : {}),
        };
        return openApiTypeToEffectSchema(
          mergedProp,
          spec,
          indent,
          new Set([...seenRefs, prop.allOf[0].$ref!]),
          ctx,
        );
      }
      // Inline schema — fall through to type/enum/object handling on `resolved`.
      return openApiTypeToEffectSchema(resolved, spec, indent, seenRefs, ctx);
    }

    const mergedProps: Record<string, SchemaObject> = {};
    const mergedRequired: string[] = [];

    for (const subSchema of prop.allOf) {
      let resolved = subSchema;
      if (subSchema.$ref) {
        resolved = resolveRef(spec, subSchema.$ref);
      }
      if (resolved.properties) {
        Object.assign(mergedProps, resolved.properties);
      }
      if (resolved.required) {
        mergedRequired.push(...resolved.required);
      }
    }

    const mergedSchema: SchemaObject = {
      type: "object",
      properties: mergedProps,
      required: [...new Set(mergedRequired)],
    };

    return generateStructSchema(mergedSchema, spec, indent, seenRefs, ctx);
  }

  // Handle oneOf/anyOf — emit a union of the branch schemas. Branches that
  // only express nullability (`{type:"null"}`, PostHog's `NullEnum`) collapse
  // into a `S.NullOr` wrapper instead of becoming a `S.Null` member.
  if (prop.oneOf || prop.anyOf) {
    // Bail out of deeply-nested unions. Inlining recursive union graphs (e.g.
    // PostHog's HogQL `query` AST) expands combinatorially into multi-hundred-MB
    // files; beyond a few `$ref` hops the precise shape isn't useful anyway.
    const unionBranches = (prop.oneOf ?? prop.anyOf)!;
    if (
      seenRefs.size > MAX_UNION_INLINE_DEPTH &&
      !isScalarUnion(unionBranches, spec)
    ) {
      return "S.Unknown";
    }
    const branches = unionBranches;
    let nullable = isNullable(prop);
    const members: string[] = [];
    for (const branch of branches) {
      if (isNullBranch(branch, spec)) {
        nullable = true;
        continue;
      }
      members.push(
        openApiTypeToEffectSchema(branch, spec, indent, seenRefs, ctx),
      );
    }
    const uniq = [...new Set(members)];
    if (uniq.length === 0) return "S.Null";
    const base =
      uniq.length === 1 ? uniq[0] : `S.Union([${uniq.join(", ")}])`;
    const result = nullable ? `S.NullOr(${base})` : base;
    return result.length > MAX_UNION_INLINE_CHARS ? "S.Unknown" : result;
  }

  // Handle enum
  if (prop.enum && prop.enum.length > 0) {
    const baseSchema = renderEnumLiterals(prop.enum, prop.type);
    return isNullable(prop) ? `S.NullOr(${baseSchema})` : baseSchema;
  }

  // Handle type
  const baseType = getBaseType(prop);
  let baseSchema: string;

  switch (baseType) {
    case "string":
      if (prop["x-sensitive"]) {
        const nullable = isNullable(prop);
        if (ctx) {
          if (nullable) ctx.usesSensitiveNullableString = true;
          else ctx.usesSensitiveString = true;
        }
        const redacted = "S.Redacted(S.String)";
        return nullable ? `S.NullOr(${redacted})` : redacted;
      }
      baseSchema = "S.String";
      break;
    case "integer":
    case "number":
      baseSchema = "S.Number";
      break;
    case "boolean":
      baseSchema = "S.Boolean";
      break;
    case "array":
      if (prop.items) {
        const itemSchema = openApiTypeToEffectSchema(
          prop.items,
          spec,
          indent,
          seenRefs,
          ctx,
        );
        baseSchema = `S.Array(${itemSchema})`;
      } else {
        baseSchema = "S.Array(S.Unknown)";
      }
      break;
    case "object":
      if (prop.properties) {
        baseSchema = generateStructSchema(prop, spec, indent, seenRefs, ctx);
      } else if (prop.additionalProperties) {
        if (typeof prop.additionalProperties === "boolean") {
          baseSchema = "S.Record(S.String, S.Unknown)";
        } else {
          const valueSchema = openApiTypeToEffectSchema(
            prop.additionalProperties,
            spec,
            indent,
            seenRefs,
            ctx,
          );
          baseSchema = `S.Record(S.String, ${valueSchema})`;
        }
      } else {
        baseSchema = "S.Unknown";
      }
      break;
    default:
      if (prop.properties) {
        baseSchema = generateStructSchema(prop, spec, indent, seenRefs, ctx);
      } else {
        baseSchema = "S.Unknown";
      }
      break;
  }

  return isNullable(prop) ? `S.NullOr(${baseSchema})` : baseSchema;
}

function generateStructSchema(
  schema: SchemaObject,
  spec: any,
  indent: string = "",
  seenRefs: Set<string> = new Set(),
  ctx?: SchemaGenerationContext,
): string {
  if (!schema.properties) return "S.Unknown";

  const required = new Set(schema.required || []);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(schema.properties)) {
    // Auto-detect sensitive fields by name pattern (only for string types without explicit x-sensitive)
    const baseType = getBaseType(value);
    const isSensitiveByName =
      baseType === "string" &&
      !value["x-sensitive"] &&
      !value.enum &&
      isSensitiveFieldName(key);
    const effectiveValue = isSensitiveByName
      ? { ...value, "x-sensitive": true }
      : value;

    const fieldSchema = openApiTypeToEffectSchema(
      effectiveValue,
      spec,
      indent + "  ",
      seenRefs,
      ctx,
    );
    const isOptional = !required.has(key);
    const safeKey = quotePropKey(key);
    if (isOptional) {
      lines.push(`${indent}  ${safeKey}: S.optional(${fieldSchema}),`);
    } else {
      lines.push(`${indent}  ${safeKey}: ${fieldSchema},`);
    }
  }

  return `S.Struct({\n${lines.join("\n")}\n${indent}})`;
}

// ============================================================================
// TypeScript type printer
//
// Mirrors `openApiTypeToEffectSchema` but emits a TS *type* string instead of a
// runtime schema. Used to emit an explicit `interface`/`type` for every
// Input/Output schema so the generated const can be cast
// `... as unknown as S.Codec<Name>` instead of relying on the expensive
// `export type X = typeof X.Type` inference (which serializes the full
// `S.Struct<{...}>` into every `.d.ts` and forces consumers to
// re-instantiate `.Type`). Keeps the public type fully inlined and
// self-contained.
// ============================================================================

function openApiTypeToTsType(
  prop: SchemaObject,
  spec: any,
  seenRefs: Set<string> = new Set(),
  ctx?: SchemaGenerationContext,
): string {
  // $ref — resolve and inline (self-contained type, no private-name references).
  if (prop.$ref) {
    if (seenRefs.has(prop.$ref)) return "unknown";
    const resolved = resolveRef(spec, prop.$ref);
    return openApiTypeToTsType(
      resolved,
      spec,
      new Set([...seenRefs, prop.$ref]),
      ctx,
    );
  }

  // allOf — single passes through; multiple merge into one object.
  if (prop.allOf && prop.allOf.length > 0) {
    if (prop.allOf.length === 1) {
      let resolved = prop.allOf[0];
      if (resolved.$ref) {
        if (seenRefs.has(resolved.$ref)) return "unknown";
        const refKey = resolved.$ref;
        resolved = resolveRef(spec, refKey);
        const mergedProp: SchemaObject = {
          ...resolved,
          ...(prop.nullable !== undefined ? { nullable: prop.nullable } : {}),
          ...(prop["x-nullable"] !== undefined
            ? { "x-nullable": prop["x-nullable"] }
            : {}),
          ...(prop["x-sensitive"] !== undefined
            ? { "x-sensitive": prop["x-sensitive"] }
            : {}),
        };
        return openApiTypeToTsType(
          mergedProp,
          spec,
          new Set([...seenRefs, refKey]),
          ctx,
        );
      }
      return openApiTypeToTsType(resolved, spec, seenRefs, ctx);
    }
    const mergedProps: Record<string, SchemaObject> = {};
    const mergedRequired: string[] = [];
    for (const subSchema of prop.allOf) {
      let resolved = subSchema;
      if (subSchema.$ref) resolved = resolveRef(spec, subSchema.$ref);
      if (resolved.properties) Object.assign(mergedProps, resolved.properties);
      if (resolved.required) mergedRequired.push(...resolved.required);
    }
    return structObjectToTsType(
      {
        type: "object",
        properties: mergedProps,
        required: [...new Set(mergedRequired)],
      },
      spec,
      seenRefs,
      ctx,
    );
  }

  if (prop.oneOf || prop.anyOf) {
    const unionBranches = (prop.oneOf ?? prop.anyOf)!;
    if (
      seenRefs.size > MAX_UNION_INLINE_DEPTH &&
      !isScalarUnion(unionBranches, spec)
    ) {
      return "unknown";
    }
    const branches = unionBranches;
    let nullable = isNullable(prop);
    const members: string[] = [];
    for (const branch of branches) {
      if (isNullBranch(branch, spec)) {
        nullable = true;
        continue;
      }
      members.push(openApiTypeToTsType(branch, spec, seenRefs, ctx));
    }
    const uniq = [...new Set(members)];
    if (uniq.length === 0) return "null";
    const base = uniq.join(" | ");
    const result = nullable ? `${base} | null` : base;
    return result.length > MAX_UNION_INLINE_CHARS ? "unknown" : result;
  }

  if (prop.enum && prop.enum.length > 0) {
    const base = prop.enum
      .map((v) => (typeof v === "string" ? JSON.stringify(v) : String(v)))
      .join(" | ");
    return isNullable(prop) ? `${base} | null` : base;
  }

  const baseType = getBaseType(prop);
  let ts: string;
  switch (baseType) {
    case "string":
      if (prop["x-sensitive"]) {
        return isNullable(prop)
          ? "Redacted.Redacted<string> | null"
          : "Redacted.Redacted<string>";
      }
      ts = "string";
      break;
    case "integer":
    case "number":
      ts = "number";
      break;
    case "boolean":
      ts = "boolean";
      break;
    case "array": {
      const item = prop.items
        ? openApiTypeToTsType(prop.items, spec, seenRefs, ctx)
        : "unknown";
      // Effect's `S.Array` decodes to `ReadonlyArray<T>`; mirror that in
      // the hand-written interface so consumers can pass `readonly T[]` values.
      ts = `ReadonlyArray<${item}>`;
      break;
    }
    case "object":
      if (prop.properties) {
        ts = structObjectToTsType(prop, spec, seenRefs, ctx);
      } else if (prop.additionalProperties) {
        const val =
          typeof prop.additionalProperties === "boolean"
            ? "unknown"
            : openApiTypeToTsType(
                prop.additionalProperties,
                spec,
                seenRefs,
                ctx,
              );
        ts = `Record<string, ${val}>`;
      } else {
        ts = "unknown";
      }
      break;
    default:
      ts = prop.properties
        ? structObjectToTsType(prop, spec, seenRefs, ctx)
        : "unknown";
      break;
  }
  return isNullable(prop) ? `${ts} | null` : ts;
}

/** Emit an inline `{ k: T; k2?: T2 }` object type for a struct schema. */
function structObjectToTsType(
  schema: SchemaObject,
  spec: any,
  seenRefs: Set<string>,
  ctx?: SchemaGenerationContext,
): string {
  if (!schema.properties) return "Record<string, unknown>";
  const required = new Set(schema.required || []);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(schema.properties)) {
    const baseType = getBaseType(value);
    const isSensitiveByName =
      baseType === "string" &&
      !value["x-sensitive"] &&
      !value.enum &&
      isSensitiveFieldName(key);
    const effectiveValue = isSensitiveByName
      ? { ...value, "x-sensitive": true }
      : value;
    const tsType = openApiTypeToTsType(effectiveValue, spec, seenRefs, ctx);
    const opt = required.has(key) ? "" : "?";
    parts.push(`${quotePropKey(key)}${opt}: ${tsType}`);
  }
  return `{ ${parts.join("; ")} }`;
}

/**
 * Build an explicit `export interface`/`export type` declaration plus a
 * `S.Codec<Name>` cast appended to the schema const. The const code passed
 * in must NOT include the trailing `export type X = typeof X.Type` line.
 */
function emitTypedSchema(
  name: string,
  tsType: string,
  constCode: string,
): string {
  const assignment = `export const ${name} = `;
  if (!constCode.startsWith(assignment)) {
    throw new Error(`Could not suspend generated schema ${name}`);
  }
  const expression = constCode
    .slice(assignment.length)
    .replace(/^\/\*@__PURE__\*\/\s*(?:\/\*#__PURE__\*\/\s*)?/, "")
    .replace(/;\s*$/, "");
  const suspended = `${assignment}/*@__PURE__*/ S.suspend(() =>
${expression
  .split("\n")
  .map((line) => `  ${line}`)
  .join("\n")}
).annotate({ identifier: "${name}" }) as unknown as S.Codec<${name}>;`;
  // Prefer an `interface` for *pure* object types (cheap, named) and a `type`
  // alias otherwise. A pure object literal both starts with `{` and ends with
  // `}` — this deliberately excludes array (`{...}[]`) and nullable
  // (`{...} | null`) shapes, which must stay `type` aliases.
  const decl = isSingleObjectLiteral(tsType)
    ? `export interface ${name} ${tsType}`
    : `export type ${name} = ${tsType};`;
  return `${decl}\n${suspended}`;
}

/**
 * True only when `s` is a single object literal — i.e. its leading `{` closes
 * exactly at the trailing `}`. Excludes arrays (`{...}[]`), nullable shapes
 * (`{...} | null`) and unions of objects (`{...} | {...}`), all of which must
 * be emitted as `type` aliases rather than `interface` declarations.
 */
function isSingleObjectLiteral(s: string): boolean {
  const t = s.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return false;
  let depth = 0;
  let inStr: string | null = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === inStr && t[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      // The outermost object closed before the end → not a single literal.
      if (depth === 0 && i !== t.length - 1) return false;
    }
  }
  return true;
}

// ============================================================================
// JSDoc Generation
// ============================================================================

function escapeJsDoc(text: string): string {
  return text.replace(/\*\//g, "*\\/").replace(/\\/g, "\\\\");
}

function formatDescription(description: string | undefined): string[] {
  if (!description) return [];

  const lines = description.split("\n");
  const result: string[] = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip authorization sections
    if (trimmed.startsWith("### Authorization")) {
      break;
    }

    // Skip markdown table markers
    if (trimmed.startsWith("|") || trimmed.startsWith("| :")) {
      inTable = true;
      continue;
    }

    if (inTable && !trimmed.startsWith("|")) {
      inTable = false;
    }

    if (!inTable && trimmed) {
      result.push(escapeJsDoc(trimmed));
    }
  }

  return result;
}

interface ParameterInfo {
  name: string;
  in: string;
  type?: string;
  required?: boolean;
  description?: string;
  enum?: (string | number | boolean)[];
  schema?: SchemaObject;
}

function generateJsDoc(
  summary: string | undefined,
  description: string | undefined,
  parameters: ParameterInfo[],
  bodyProperties?: Record<string, SchemaObject>,
): string {
  const lines: string[] = ["/**"];

  if (summary) {
    lines.push(` * ${escapeJsDoc(summary)}`);
  }

  const descLines = formatDescription(description);
  if (descLines.length > 0) {
    const descText = descLines.join(" ");
    if (descText !== summary) {
      if (summary) lines.push(" *");
      for (const line of descLines) {
        lines.push(` * ${line}`);
      }
    }
  }

  const documentedParams = parameters.filter(
    (p) => p.description && p.in !== "body",
  );
  if (documentedParams.length > 0) {
    lines.push(" *");
    for (const param of documentedParams) {
      const desc = escapeJsDoc(param.description || "");
      lines.push(` * @param ${param.name} - ${desc}`);
    }
  }

  // Document body properties
  if (bodyProperties) {
    for (const [key, value] of Object.entries(bodyProperties)) {
      if (value.description) {
        lines.push(` * @param ${key} - ${escapeJsDoc(value.description)}`);
      }
    }
  }

  lines.push(" */");

  if (lines.length === 2) {
    return "";
  }

  return lines.join("\n");
}

// ============================================================================
// Code Generation - Swagger 2.0
// ============================================================================

interface GeneratedOperation {
  fileName: string;
  serviceName: string;
  code: string;
  functionName: string;
  exports: string[];
}

function generateInputSchemaSwagger(
  operationId: string,
  method: OpenAPIHttpMethod,
  pathTemplate: string,
  parameters: Parameter2[],
  spec: Swagger2Spec,
  ctx?: SchemaGenerationContext,
  successCode?: number,
): { inputSchemaCode: string; inputSchemaName: string } {
  const inputSchemaName = `${toPascalCase(operationId)}Input`;
  const pathParams = parameters.filter((p) => p.in === "path");
  const queryParams = parameters.filter((p) => p.in === "query");
  const headerParams = parameters.filter((p) => p.in === "header");
  const bodyParam = parameters.find((p) => p.in === "body");

  const fields: string[] = [];
  // Parallel TS-type fields for the explicit input interface.
  const tsFields: string[] = [];
  const paramEnumTs = (
    values: (string | number | boolean)[],
    type: string | undefined,
  ): string =>
    values
      .map((v) =>
        type === "integer" || type === "number" || type === "boolean"
          ? String(v)
          : JSON.stringify(v),
      )
      .join(" | ");
  // Track emitted field names so later groups (query, body) don't redeclare a
  // name already taken by an earlier group. Path params win — without this, a
  // body field sharing a path param's name (e.g. `billingAccountId`) would be
  // emitted second and clobber the `T.PathParam()` binding.
  const usedNames = new Set<string>();

  // Path parameters
  for (const param of pathParams) {
    if (usedNames.has(param.name)) continue;
    usedNames.add(param.name);
    const baseSchema = param.enum
      ? renderEnumLiterals(param.enum, param.type)
      : param.type === "integer"
        ? "S.Number"
        : "S.String";
    fields.push(
      `  ${quotePropKey(param.name)}: ${baseSchema}.pipe(T.Label(${JSON.stringify(param.name)})),`,
    );
    const tsBase = param.enum
      ? paramEnumTs(param.enum, param.type)
      : param.type === "integer"
        ? "number"
        : "string";
    tsFields.push(`${quotePropKey(param.name)}: ${tsBase}`);
  }

  // Query parameters
  for (const param of queryParams) {
    if (usedNames.has(param.name)) continue;
    usedNames.add(param.name);
    let schema = param.enum
      ? renderEnumLiterals(param.enum, param.type)
      : param.type === "integer" || param.type === "number"
        ? "S.Number"
        : param.type === "boolean"
          ? "S.Boolean"
          : "S.String";

    if (!param.required) {
      schema = `S.optional(${schema})`;
    }
    fields.push(
      `  ${quotePropKey(param.name)}: ${schema}.pipe(T.Query(${JSON.stringify(param.name)})),`,
    );
    const tsBase = param.enum
      ? paramEnumTs(param.enum, param.type)
      : param.type === "integer" || param.type === "number"
        ? "number"
        : param.type === "boolean"
          ? "boolean"
          : "string";
    tsFields.push(
      `${quotePropKey(param.name)}${param.required ? "" : "?"}: ${tsBase}`,
    );
  }

  // Header parameters
  for (const param of headerParams) {
    if (usedNames.has(param.name)) continue;
    usedNames.add(param.name);
    let schema = param.enum
      ? renderEnumLiterals(param.enum, param.type)
      : param.type === "integer" || param.type === "number"
        ? "S.Number"
        : param.type === "boolean"
          ? "S.Boolean"
          : "S.String";

    if (!param.required) {
      schema = `S.optional(${schema})`;
    }
    fields.push(
      `  ${quotePropKey(param.name)}: ${schema}.pipe(T.Header(${JSON.stringify(param.name)})),`,
    );
    const tsBase = param.enum
      ? paramEnumTs(param.enum, param.type)
      : param.type === "integer" || param.type === "number"
        ? "number"
        : param.type === "boolean"
          ? "boolean"
          : "string";
    tsFields.push(
      `${quotePropKey(param.name)}${param.required ? "" : "?"}: ${tsBase}`,
    );
  }

  // Body parameters
  if (bodyParam?.schema) {
    let bodySchema = bodyParam.schema;
    // Resolve a top-level `$ref` body (e.g. `{ $ref: "#/definitions/ResourceGroup" }`).
    // Without this, `bodySchema.properties` is undefined and the request body is
    // emitted empty — breaking create/update operations. Mirrors the OAS3 emitter.
    if (bodySchema.$ref) {
      bodySchema = resolveRef(
        spec as any,
        bodySchema.$ref,
      ) as typeof bodySchema;
    }
    // Flatten `allOf` so inherited properties surface as body fields.
    if (bodySchema.allOf && bodySchema.allOf.length > 0) {
      const mergedProps: Record<string, any> = {
        ...bodySchema.properties,
      };
      const mergedRequired: string[] = [...(bodySchema.required ?? [])];
      for (const subSchema of bodySchema.allOf) {
        const resolvedSub = subSchema.$ref
          ? (resolveRef(spec as any, subSchema.$ref) as any)
          : subSchema;
        if (resolvedSub.properties)
          Object.assign(mergedProps, resolvedSub.properties);
        if (resolvedSub.required) mergedRequired.push(...resolvedSub.required);
      }
      bodySchema = {
        ...bodySchema,
        type: "object",
        properties: mergedProps,
        required: [...new Set(mergedRequired)],
      } as typeof bodySchema;
    }
    const key = usedNames.has("body") ? "$body" : "body";
    const bodyValueSchema = openApiTypeToEffectSchema(
      bodySchema,
      spec,
      "  ",
      new Set(),
      ctx,
    );
    const bodyValueType = openApiTypeToTsType(
      bodySchema,
      spec,
      new Set(),
      ctx,
    );
    const annotated = `${bodyValueSchema}.pipe(T.HttpBody())`;
    fields.push(
      `  ${quotePropKey(key)}: ${bodyParam.required ? annotated : `S.optional(${annotated})`},`,
    );
    tsFields.push(
      `${quotePropKey(key)}${bodyParam.required ? "" : "?"}: ${bodyValueType}`,
    );
  }

  const swaggerHttpTraitParts = [
    `method: ${renderHttpMethod(method)}`,
    `uri: "${pathTemplate}"`,
  ];
  if (successCode !== undefined) {
    swaggerHttpTraitParts.push(`code: ${successCode}`);
  }
  const inputSchemaCode = emitTypedSchema(
    inputSchemaName,
    `{ ${tsFields.join("; ")} }`,
    annotatePureExportConst(`export const ${inputSchemaName} = S.Struct({
${fields.join("\n")}
}).pipe(T.Http({ ${swaggerHttpTraitParts.join(", ")} }));`),
  );

  return { inputSchemaCode, inputSchemaName };
}

// ============================================================================
// Code Generation - OpenAPI 3.x
// ============================================================================

function resolveParameters3(
  spec: OpenAPI3Spec,
  pathParams: ParameterObject3[] | undefined,
  operationParams: ParameterObject3[] | undefined,
): ParameterObject3[] {
  const params: ParameterObject3[] = [];

  if (pathParams) {
    for (const param of pathParams) {
      if (param.$ref) {
        params.push(resolveParameterRef(spec, param.$ref));
      } else {
        params.push(param);
      }
    }
  }

  if (operationParams) {
    for (const param of operationParams) {
      if (param.$ref) {
        params.push(resolveParameterRef(spec, param.$ref));
      } else {
        params.push(param);
      }
    }
  }

  return params;
}

function generateInputSchema3(
  operationId: string,
  method: OpenAPIHttpMethod,
  pathTemplate: string,
  parameters: ParameterObject3[],
  requestBodyParam: RequestBody3 | undefined,
  spec: OpenAPI3Spec,
  ctx?: SchemaGenerationContext,
  successCode?: number,
): { inputSchemaCode: string; inputSchemaName: string } {
  // Resolve top-level $ref (e.g. #/components/requestBodies/Foo).
  const requestBody = requestBodyParam?.$ref
    ? (resolveRef(spec as any, requestBodyParam.$ref) as RequestBody3)
    : requestBodyParam;
  const inputSchemaName = `${toPascalCase(operationId)}Input`;
  const pathParams = parameters.filter((p) => p.in === "path");
  const queryParams = parameters.filter((p) => p.in === "query");
  const headerParams = parameters.filter((p) => p.in === "header");

  const fields: string[] = [];
  const tsFields: string[] = [];
  const paramSchemaTs = (schema: SchemaObject | undefined): string => {
    if (!schema) return "string";
    return openApiTypeToTsType(schema, spec, new Set(), ctx);
  };
  const usedNames = new Set<string>();

  // Path parameters
  for (const param of pathParams) {
    if (usedNames.has(param.name)) continue;
    usedNames.add(param.name);
    const schema = param.schema;
    const baseSchema =
      schema?.enum && schema.enum.length > 0
        ? renderEnumLiterals(schema.enum, schema.type)
        : schema?.type === "integer" || schema?.type === "number"
          ? "S.Number"
          : "S.String";
    fields.push(
      `  ${quotePropKey(param.name)}: ${baseSchema}.pipe(T.Label(${JSON.stringify(param.name)})),`,
    );
    tsFields.push(`${quotePropKey(param.name)}: ${paramSchemaTs(schema)}`);
  }

  // Query parameters
  for (const param of queryParams) {
    if (usedNames.has(param.name)) continue;
    usedNames.add(param.name);
    const schema = param.schema;
    let schemaStr = renderParameterSchema3(schema, spec, ctx);

    if (!param.required) {
      schemaStr = `S.optional(${schemaStr})`;
    }
    fields.push(
      `  ${quotePropKey(param.name)}: ${schemaStr}.pipe(T.Query(${JSON.stringify(param.name)})),`,
    );
    tsFields.push(
      `${quotePropKey(param.name)}${param.required ? "" : "?"}: ${paramSchemaTs(schema)}`,
    );
  }

  // Header parameters
  for (const param of headerParams) {
    if (usedNames.has(param.name)) continue;
    usedNames.add(param.name);
    const schema = param.schema;
    let schemaStr = renderParameterSchema3(schema, spec, ctx);

    if (!param.required) {
      schemaStr = `S.optional(${schemaStr})`;
    }
    fields.push(
      `  ${quotePropKey(param.name)}: ${schemaStr}.pipe(T.Header(${JSON.stringify(param.name)})),`,
    );
    tsFields.push(
      `${quotePropKey(param.name)}${param.required ? "" : "?"}: ${paramSchemaTs(schema)}`,
    );
  }

  // Request body — check for JSON, form-urlencoded, or multipart content
  let bodyContentType: string | undefined;
  if (requestBody?.content) {
    const jsonContent = requestBody.content["application/json"];
    const formContent =
      requestBody.content["application/x-www-form-urlencoded"];
    const multipartContent = requestBody.content["multipart/form-data"];
    const bodyContent = jsonContent ?? formContent ?? multipartContent;
    if (formContent && !jsonContent) {
      bodyContentType = "form-urlencoded";
    } else if (multipartContent && !jsonContent && !formContent) {
      bodyContentType = "multipart";
    }
    if (bodyContent?.schema) {
      let bodySchema = bodyContent.schema;
      if (bodySchema.$ref) {
        bodySchema = resolveRef(spec, bodySchema.$ref);
      }

      // Flatten `allOf` so a body schema like `{ allOf: [BranchCreateRequest,
      // AnnotationCreateValueRequest] }` exposes the union of its sub-schemas'
      // properties as fields, instead of degenerating to an empty body.
      if (bodySchema.allOf && bodySchema.allOf.length > 0) {
        const mergedProps: Record<string, SchemaObject> = {
          ...bodySchema.properties,
        };
        const mergedRequired: string[] = [...(bodySchema.required ?? [])];
        for (const subSchema of bodySchema.allOf) {
          const resolvedSub = subSchema.$ref
            ? (resolveRef(spec, subSchema.$ref) as SchemaObject)
            : subSchema;
          if (resolvedSub.properties) {
            Object.assign(mergedProps, resolvedSub.properties);
          }
          if (resolvedSub.required) {
            mergedRequired.push(...resolvedSub.required);
          }
        }
        bodySchema = {
          ...bodySchema,
          type: "object",
          properties: mergedProps,
          required: [...new Set(mergedRequired)],
        };
      }

      const key = usedNames.has("body") ? "$body" : "body";
      const bodyValueSchema = openApiTypeToEffectSchema(
        bodySchema,
        spec,
        "  ",
        new Set(),
        ctx,
      );
      const bodyValueType = openApiTypeToTsType(
        bodySchema,
        spec,
        new Set(),
        ctx,
      );
      const annotated = `${bodyValueSchema}.pipe(T.HttpBody())`;
      fields.push(
        `  ${quotePropKey(key)}: ${requestBody.required ? annotated : `S.optional(${annotated})`},`,
      );
      tsFields.push(
        `${quotePropKey(key)}${requestBody.required ? "" : "?"}: ${bodyValueType}`,
      );
    }
  }

  const httpTraitParts = [
    `method: ${renderHttpMethod(method)}`,
    `uri: "${pathTemplate}"`,
  ];
  if (successCode !== undefined) {
    httpTraitParts.push(`code: ${successCode}`);
  }
  if (bodyContentType) {
    httpTraitParts.push(`contentType: "${bodyContentType}"`);
  }
  const inputSchemaCode = emitTypedSchema(
    inputSchemaName,
    `{ ${tsFields.join("; ")} }`,
    annotatePureExportConst(`export const ${inputSchemaName} = S.Struct({
${fields.join("\n")}
}).pipe(T.Http({ ${httpTraitParts.join(", ")} }));`),
  );

  return { inputSchemaCode, inputSchemaName };
}

// ============================================================================
// Shared Output Schema Generation
// ============================================================================

function getResponseSchema(
  spec: any,
  version: SpecVersion,
  responses: Record<string, any>,
): SchemaObject | null {
  const successStatus = Object.keys(responses)
    .filter((status) => /^2\d\d$/.test(status))
    .sort((a, b) => Number(a) - Number(b))[0];
  const successResponse = successStatus
    ? responses[successStatus]
    : undefined;
  if (!successResponse) return null;

  if (version === "2.0") {
    // Swagger 2.0
    if (!successResponse.schema) return null;
    if (successResponse.schema.$ref) {
      return resolveRef(spec, successResponse.schema.$ref);
    }
    return successResponse.schema;
  } else {
    // OAS 3.x
    let response = successResponse;
    if (response.$ref) {
      response = resolveResponseRef(spec, response.$ref);
    }
    const content = response.content;
    if (!content) return null;
    const jsonContent = content["application/json"];
    if (!jsonContent?.schema) return null;
    if (jsonContent.schema.$ref) {
      return resolveRef(spec, jsonContent.schema.$ref);
    }
    return jsonContent.schema;
  }
}

function getSuccessCode(responses: Record<string, unknown>): number | undefined {
  const status = Object.keys(responses)
    .filter((candidate) => /^2\d\d$/.test(candidate))
    .sort((a, b) => Number(a) - Number(b))[0];
  return status === undefined ? undefined : Number(status);
}

function generateOutputSchema(
  operationId: string,
  responseSchema: SchemaObject | null,
  spec: any,
): {
  outputSchemaCode: string;
  outputSchemaName: string;
  sensitiveImports: {
    usesSensitiveString: boolean;
    usesSensitiveNullableString: boolean;
    usesSensitiveOutputString: boolean;
    usesSensitiveOutputNullableString: boolean;
  };
} {
  const outputSchemaName = toPascalCase(operationId) + "Output";
  const ctx: SchemaGenerationContext = {
    direction: "output",
    usesSensitiveString: false,
    usesSensitiveNullableString: false,
    usesSensitiveOutputString: false,
    usesSensitiveOutputNullableString: false,
  };

  if (!responseSchema) {
    return {
      outputSchemaCode: emitTypedSchema(
        outputSchemaName,
        "void",
        `export const ${outputSchemaName} = /*@__PURE__*/ /*#__PURE__*/ S.Void;`,
      ),
      outputSchemaName,
      sensitiveImports: {
        usesSensitiveString: false,
        usesSensitiveNullableString: false,
        usesSensitiveOutputString: false,
        usesSensitiveOutputNullableString: false,
      },
    };
  }

  // Handle array responses
  if (
    (responseSchema.type === "array" ||
      (Array.isArray(responseSchema.type) &&
        responseSchema.type.includes("array"))) &&
    responseSchema.items
  ) {
    const itemSchema = openApiTypeToEffectSchema(
      responseSchema.items,
      spec,
      "",
      new Set(),
      ctx,
    );
    const itemTs = openApiTypeToTsType(
      responseSchema.items,
      spec,
      new Set(),
      ctx,
    );
    return {
      outputSchemaCode: emitTypedSchema(
        outputSchemaName,
        `ReadonlyArray<${itemTs}>`,
        `export const ${outputSchemaName} = /*@__PURE__*/ /*#__PURE__*/ S.Array(${itemSchema});`,
      ),
      outputSchemaName,
      sensitiveImports: {
        usesSensitiveString: ctx.usesSensitiveString,
        usesSensitiveNullableString: ctx.usesSensitiveNullableString,
        usesSensitiveOutputString: ctx.usesSensitiveOutputString,
        usesSensitiveOutputNullableString:
          ctx.usesSensitiveOutputNullableString,
      },
    };
  }

  const schemaCode = openApiTypeToEffectSchema(
    responseSchema,
    spec,
    "",
    new Set(),
    ctx,
  );
  const responseTs = openApiTypeToTsType(responseSchema, spec, new Set(), ctx);
  return {
    outputSchemaCode: emitTypedSchema(
      outputSchemaName,
      responseTs,
      `export const ${outputSchemaName} = /*@__PURE__*/ /*#__PURE__*/ ${schemaCode};`,
    ),
    outputSchemaName,
    sensitiveImports: {
      usesSensitiveString: ctx.usesSensitiveString,
      usesSensitiveNullableString: ctx.usesSensitiveNullableString,
      usesSensitiveOutputString: ctx.usesSensitiveOutputString,
      usesSensitiveOutputNullableString: ctx.usesSensitiveOutputNullableString,
    },
  };
}

// ============================================================================
// Main Generator
// ============================================================================

const GENERATED_FILE_HEADER =
  "// Generated by @kevinmichaelchen/distilled. Do not edit by hand.";
export const OPENAPI_COVERAGE_FILE_NAME = "coverage.json";

type MutableMethodCoverage = {
  total: number;
  deprecated: number;
  skippedDeprecated: number;
  attempted: number;
  generated: number;
  failed: number;
};

function makeMethodCoverage(): Record<
  UppercaseHttpMethod,
  MutableMethodCoverage
> {
  return Object.fromEntries(
    OPENAPI_HTTP_METHODS.map((method) => [
      method.toUpperCase(),
      {
        total: 0,
        deprecated: 0,
        skippedDeprecated: 0,
        attempted: 0,
        generated: 0,
        failed: 0,
      },
    ]),
  ) as Record<UppercaseHttpMethod, MutableMethodCoverage>;
}

function countUnsupportedOperations(
  paths: Record<string, Record<string, unknown>>,
): number {
  const metadataKeys = new Set([
    "$ref",
    "summary",
    "description",
    "servers",
    "parameters",
  ]);
  const supported = new Set<string>(OPENAPI_HTTP_METHODS);
  let count = 0;

  for (const pathItem of Object.values(paths)) {
    for (const [key, value] of Object.entries(pathItem)) {
      if (supported.has(key) || metadataKeys.has(key) || key.startsWith("x-")) {
        continue;
      }
      if (
        value !== null &&
        typeof value === "object" &&
        "responses" in value
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function makeOperationFailure(
  method: OpenAPIHttpMethod,
  pathTemplate: string,
  operationId: string | undefined,
  cause: unknown,
): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    `${method.toUpperCase()} ${pathTemplate}${operationId ? ` (${operationId})` : ""}: ${detail}`,
    { cause },
  );
}

function writeGeneratedOutput(
  outputDir: string,
  operations: readonly GeneratedOperation[],
  coverage: GenerationCoverage,
): void {
  const parentDir = path.dirname(outputDir);
  const outputName = path.basename(outputDir);
  fs.mkdirSync(parentDir, { recursive: true });

  const stagingDir = fs.mkdtempSync(
    path.join(parentDir, `.${outputName}.staging-`),
  );
  let backupDir: string | undefined;

  try {
    const services = new Map<string, GeneratedOperation[]>();
    for (const operation of operations) {
      const grouped = services.get(operation.serviceName) ?? [];
      grouped.push(operation);
      services.set(operation.serviceName, grouped);
    }

    const serviceNames = [...services.keys()].sort();
    for (const serviceName of serviceNames) {
      const grouped = services.get(serviceName)!;
      const namespaceImports = new Set<string>();
      const namedImports = new Map<string, Set<string>>();
      const bodies: string[] = [];
      for (const operation of grouped) {
        const body: string[] = [];
        for (const line of operation.code.split("\n")) {
          const named = /^import \{ (.+) \} from "(.+)";$/.exec(line);
          if (named) {
            const bindings = namedImports.get(named[2]!) ?? new Set<string>();
            for (const binding of named[1]!.split(", ")) bindings.add(binding);
            namedImports.set(named[2]!, bindings);
          } else if (line.startsWith("import ")) {
            namespaceImports.add(line);
          } else {
            body.push(line);
          }
        }
        bodies.push(body.join("\n").trim());
      }
      const imports = [
        ...namespaceImports,
        ...[...namedImports.entries()].map(
          ([source, bindings]) =>
            `import { ${[...bindings].join(", ")} } from "${source}";`,
        ),
      ];
      const module = [
        GENERATED_FILE_HEADER,
        ...imports,
        "",
        ...bodies.flatMap((body, index) =>
          index === bodies.length - 1 ? [body] : [body, ""],
        ),
        "",
      ].join("\n");
      fs.writeFileSync(path.join(stagingDir, `${serviceName}.ts`), module);
    }

    const barrelContent = `${GENERATED_FILE_HEADER}\n${serviceNames
      .map((name) => `export * as ${name} from "./${name}.ts";`)
      .join("\n")}\n`;
    fs.writeFileSync(path.join(stagingDir, "index.ts"), barrelContent);
    fs.writeFileSync(
      path.join(stagingDir, OPENAPI_COVERAGE_FILE_NAME),
      `${JSON.stringify(coverage, null, 2)}\n`,
    );

    if (fs.existsSync(outputDir)) {
      backupDir = fs.mkdtempSync(
        path.join(parentDir, `.${outputName}.backup-`),
      );
      fs.rmdirSync(backupDir);
      fs.renameSync(outputDir, backupDir);
    }

    try {
      fs.renameSync(stagingDir, outputDir);
    } catch (error) {
      if (backupDir && fs.existsSync(backupDir) && !fs.existsSync(outputDir)) {
        fs.renameSync(backupDir, outputDir);
        backupDir = undefined;
      }
      throw error;
    }

    if (backupDir) {
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Could not remove generation backup ${backupDir}:`, error);
      }
      backupDir = undefined;
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

export function generateFromOpenAPI(
  config: GeneratorConfig,
): GenerationCoverage {
  const specPath = path.resolve(config.specPath);
  const patchDir = path.resolve(config.patchDir);
  const outputDir = path.resolve(config.outputDir);

  // Read spec
  const specContent = fs.readFileSync(specPath, "utf-8");
  const spec = JSON.parse(specContent);

  // Detect version
  const version = detectVersion(spec);

  // Apply patches
  const {
    applied,
    skipped: patchSkipped,
    errors: patchErrors,
  } = applyAllPatches(spec, patchDir);
  if (patchSkipped.length > 0) {
    console.warn("Skipped stale patch operations (target no longer in spec):");
    for (const msg of patchSkipped) {
      console.warn(`  ⚠ ${msg}`);
    }
  }
  if (patchErrors.length > 0) {
    throw new AggregateError(
      patchErrors.map((message) => new Error(message)),
      `Could not apply ${patchErrors.length} OpenAPI patch operation${patchErrors.length === 1 ? "" : "s"}`,
    );
  }

  // Status-to-error-class mapping
  const statusToErrorClass = config.statusToErrorClass ?? {
    "400": "BadRequest",
    "403": "Forbidden",
    "404": "NotFound",
    "409": "Conflict",
    "422": "UnprocessableEntity",
  };
  const defaultErrorStatuses =
    config.defaultErrorStatuses ?? new Set(["401", "429", "500", "503"]);

  const includeOperationErrors =
    config.includeOperationErrors ?? version === "2.0";

  // Collect all operations
  const operations: GeneratedOperation[] = [];
  const usedFunctionNames = new Set<string>();
  const failures: Error[] = [];
  const byMethod = makeMethodCoverage();
  let total = 0;
  let deprecated = 0;
  let skippedDeprecated = 0;
  let attempted = 0;
  let generated = 0;
  let failed = 0;
  const skipDeprecated = config.skipDeprecated !== false;
  const unsupported = countUnsupportedOperations(spec.paths ?? {});
  if (unsupported > 0) {
    failures.push(
      new Error(
        `OpenAPI document contains ${unsupported} operation${unsupported === 1 ? "" : "s"} with unsupported HTTP methods`,
      ),
    );
  }

  if (version === "2.0") {
    // Swagger 2.0 codepath
    const swagger = spec as Swagger2Spec;
    for (const [pathTemplate, pathItem] of Object.entries(swagger.paths)) {
      for (const method of OPENAPI_HTTP_METHODS) {
        const operation = pathItem[method];
        if (!operation) continue;
        const methodCoverage = byMethod[method.toUpperCase() as UppercaseHttpMethod];
        total += 1;
        methodCoverage.total += 1;
        if (operation.deprecated) {
          deprecated += 1;
          methodCoverage.deprecated += 1;
        }
        if (skipDeprecated && operation.deprecated) {
          skippedDeprecated += 1;
          methodCoverage.skippedDeprecated += 1;
          continue;
        }
        attempted += 1;
        methodCoverage.attempted += 1;

        try {
          const operationId = resolveOperationId(
            operation,
            method,
            pathTemplate,
            usedFunctionNames,
          );
          const functionName = operationIdToFunctionName(operationId);
          // Merge path-level params and resolve `$ref`s before filtering by
          // `in` — otherwise ref'd path/query params are dropped.
          const parameters = resolveParameters2(
            swagger,
            pathItem.parameters,
            operation.parameters,
          );

          const jsDoc = generateJsDoc(
            operation.summary,
            operation.description,
            parameters.map((p) => ({
              name: p.name,
              in: p.in,
              type: p.type,
              required: p.required,
              description: p.description,
              enum: p.enum,
            })),
            parameters.find((p) => p.in === "body")?.schema?.properties,
          );

          const sensitiveCtx: SchemaGenerationContext = {
            direction: "input",
            usesSensitiveString: false,
            usesSensitiveNullableString: false,
            usesSensitiveOutputString: false,
            usesSensitiveOutputNullableString: false,
          };

          const { inputSchemaCode, inputSchemaName } =
            generateInputSchemaSwagger(
              operationId,
              method,
              pathTemplate,
              parameters,
              swagger,
              sensitiveCtx,
              getSuccessCode(operation.responses),
            );

          const responseSchema = getResponseSchema(
            swagger,
            version,
            operation.responses,
          );
          const {
            outputSchemaCode,
            outputSchemaName,
            sensitiveImports: outputSensitiveImports,
          } = generateOutputSchema(
            operationId,
            responseSchema,
            swagger,
          );
          const sensitiveImports = {
            usesSensitiveString:
              sensitiveCtx.usesSensitiveString ||
              outputSensitiveImports.usesSensitiveString,
            usesSensitiveNullableString:
              sensitiveCtx.usesSensitiveNullableString ||
              outputSensitiveImports.usesSensitiveNullableString,
            usesSensitiveOutputString:
              sensitiveCtx.usesSensitiveOutputString ||
              outputSensitiveImports.usesSensitiveOutputString,
            usesSensitiveOutputNullableString:
              sensitiveCtx.usesSensitiveOutputNullableString ||
              outputSensitiveImports.usesSensitiveOutputNullableString,
          };

          // Get operation-specific errors
          let operationErrors: string[] = [];
          if (includeOperationErrors) {
            for (const status of Object.keys(operation.responses)) {
              if (status.startsWith("2") || defaultErrorStatuses.has(status))
                continue;
              const errorClass = statusToErrorClass[status];
              if (errorClass) {
                operationErrors.push(errorClass);
              }
            }
          }

          const pagination = detectPagination(
            parameters as ParameterObject3[],
            responseSchema,
            spec,
          );

          const code = buildOperationFile(
            method,
            functionName,
            inputSchemaCode,
            inputSchemaName,
            outputSchemaCode,
            outputSchemaName,
            jsDoc,
            operationErrors,
            sensitiveImports,
            pagination,
            config,
          );

          operations.push({
            fileName: `${resolveServiceName(operation.tags, pathTemplate)}.ts`,
            serviceName: resolveServiceName(operation.tags, pathTemplate),
            code,
            functionName,
            exports: [inputSchemaName, outputSchemaName, functionName],
          });
          generated += 1;
          methodCoverage.generated += 1;
        } catch (error) {
          failed += 1;
          methodCoverage.failed += 1;
          failures.push(
            makeOperationFailure(
              method,
              pathTemplate,
              operation.operationId,
              error,
            ),
          );
        }
      }
    }
  } else {
    // OpenAPI 3.x codepath
    const oas = spec as OpenAPI3Spec;
    for (const [pathTemplate, pathItem] of Object.entries(oas.paths)) {
      const pathLevelParams = pathItem.parameters;

      for (const method of OPENAPI_HTTP_METHODS) {
        const operation = pathItem[method];
        if (!operation) continue;
        const methodCoverage = byMethod[method.toUpperCase() as UppercaseHttpMethod];
        total += 1;
        methodCoverage.total += 1;
        if (operation.deprecated) {
          deprecated += 1;
          methodCoverage.deprecated += 1;
        }
        if (skipDeprecated && operation.deprecated) {
          skippedDeprecated += 1;
          methodCoverage.skippedDeprecated += 1;
          continue;
        }
        attempted += 1;
        methodCoverage.attempted += 1;

        try {
          const operationId = resolveOperationId(
            operation,
            method,
            pathTemplate,
            usedFunctionNames,
          );
          const functionName = operationIdToFunctionName(operationId);
          const parameters = resolveParameters3(
            oas,
            pathLevelParams,
            operation.parameters,
          );

          const jsDoc = generateJsDoc(
            operation.summary,
            operation.description,
            parameters.map((p) => ({
              name: p.name,
              in: p.in,
              required: p.required,
              description: p.description,
            })),
          );

          const sensitiveCtx: SchemaGenerationContext = {
            direction: "input",
            usesSensitiveString: false,
            usesSensitiveNullableString: false,
            usesSensitiveOutputString: false,
            usesSensitiveOutputNullableString: false,
          };

          const { inputSchemaCode, inputSchemaName } = generateInputSchema3(
            operationId,
            method,
            pathTemplate,
            parameters,
            operation.requestBody,
            oas,
            sensitiveCtx,
            getSuccessCode(operation.responses),
          );

          const responseSchema = getResponseSchema(
            oas,
            version,
            operation.responses,
          );
          const {
            outputSchemaCode,
            outputSchemaName,
            sensitiveImports: outputSensitiveImports,
          } = generateOutputSchema(operationId, responseSchema, oas);
          const sensitiveImports = {
            usesSensitiveString:
              sensitiveCtx.usesSensitiveString ||
              outputSensitiveImports.usesSensitiveString,
            usesSensitiveNullableString:
              sensitiveCtx.usesSensitiveNullableString ||
              outputSensitiveImports.usesSensitiveNullableString,
            usesSensitiveOutputString:
              sensitiveCtx.usesSensitiveOutputString ||
              outputSensitiveImports.usesSensitiveOutputString,
            usesSensitiveOutputNullableString:
              sensitiveCtx.usesSensitiveOutputNullableString ||
              outputSensitiveImports.usesSensitiveOutputNullableString,
          };

          // Get operation-specific errors
          let operationErrors: string[] = [];
          if (includeOperationErrors) {
            for (const status of Object.keys(operation.responses)) {
              if (status.startsWith("2") || defaultErrorStatuses.has(status))
                continue;
              const errorClass = statusToErrorClass[status];
              if (errorClass) {
                operationErrors.push(errorClass);
              }
            }
          }

          const pagination = detectPagination(
            parameters as ParameterObject3[],
            responseSchema,
            spec,
          );

          const code = buildOperationFile(
            method,
            functionName,
            inputSchemaCode,
            inputSchemaName,
            outputSchemaCode,
            outputSchemaName,
            jsDoc,
            operationErrors,
            sensitiveImports,
            pagination,
            config,
          );

          operations.push({
            fileName: `${resolveServiceName(operation.tags, pathTemplate)}.ts`,
            serviceName: resolveServiceName(operation.tags, pathTemplate),
            code,
            functionName,
            exports: [inputSchemaName, outputSchemaName, functionName],
          });
          generated += 1;
          methodCoverage.generated += 1;
        } catch (error) {
          failed += 1;
          methodCoverage.failed += 1;
          failures.push(
            makeOperationFailure(
              method,
              pathTemplate,
              operation.operationId,
              error,
            ),
          );
        }
      }
    }
  }

  const coverage: GenerationCoverage = {
    schemaVersion: 1,
    spec: {
      format: version,
      title: String(spec.info?.title ?? ""),
      version: String(spec.info?.version ?? ""),
    },
    configuration: { skipDeprecated },
    patches: {
      applied: [...applied],
      skipped: [...patchSkipped],
    },
    operations: {
      total,
      deprecated,
      skippedDeprecated,
      attempted,
      generated,
      failed,
      unsupported,
      byMethod,
    },
  };

  if (failures.length > 0) {
    throw new OpenAPIGenerationError(failures, coverage);
  }

  // Stage the complete projection first. The existing directory remains
  // untouched if operation generation or any staging write fails.
  writeGeneratedOutput(outputDir, operations, coverage);
  for (const op of operations) {
    console.log(`✅ ${op.functionName}`);
  }
  return coverage;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Detect cursor / page / token pagination on an operation by looking at the
 * input parameters and the (resolved) response schema.
 *
 * Returns the `pagination` trait to feed into `API.makePaginated`, or
 * `undefined` if the operation isn't paginated.
 */
function detectPagination(
  parameters: ParameterObject3[] | undefined,
  responseSchema: SchemaObject | null,
  spec: any,
):
  | {
      mode: "cursor" | "page" | "token";
      inputToken: string;
      outputToken: string;
      items: string;
    }
  | undefined {
  if (!responseSchema) return undefined;

  // Resolve the response schema if it's still a $ref (callers usually
  // pre-resolve, but be defensive).
  let resolved = responseSchema;
  if (resolved.$ref) {
    resolved = resolveRef(spec, resolved.$ref);
  }
  // Flatten allOf into a single property bag for inspection.
  let outputProps: Record<string, SchemaObject> = resolved.properties ?? {};
  if (resolved.allOf) {
    outputProps = { ...outputProps };
    for (const sub of resolved.allOf) {
      const r = sub.$ref ? (resolveRef(spec, sub.$ref) as SchemaObject) : sub;
      if (r.properties) Object.assign(outputProps, r.properties);
    }
  }

  // Find the next-page indicator on the output. Patterns we recognise:
  //   pagination.cursor  / pagination.next  -> cursor mode
  //   pagination.next_page                  -> page mode
  //   next_token / NextToken                -> token mode (top-level)
  //   next_page                             -> page mode (top-level)
  let outputToken: string | undefined;
  let mode: "cursor" | "page" | "token" | undefined;

  const paginationProp = outputProps.pagination;
  if (paginationProp) {
    let p = paginationProp;
    if (p.$ref) p = resolveRef(spec, p.$ref);
    const subProps = p.properties ?? {};
    if (subProps.cursor) {
      outputToken = "pagination.cursor";
      mode = "cursor";
    } else if (subProps.next) {
      outputToken = "pagination.next";
      mode = "cursor";
    } else if (subProps.next_page) {
      outputToken = "pagination.next_page";
      mode = "page";
    }
  }
  if (!outputToken) {
    for (const candidate of ["next_token", "NextToken", "nextToken"]) {
      if (outputProps[candidate]) {
        outputToken = candidate;
        mode = "token";
        break;
      }
    }
  }
  if (!outputToken) {
    if (outputProps.next_page) {
      outputToken = "next_page";
      mode = "page";
    }
  }
  if (!outputToken || !mode) return undefined;

  // Find the matching input token. The query/path/etc. parameter that
  // carries the cursor / page / next-token between requests.
  const cursorAliases = ["cursor", "page_token", "pageToken"];
  const tokenAliases = ["next_token", "NextToken", "nextToken"];
  const pageAliases = ["page"];
  const wanted =
    mode === "cursor"
      ? cursorAliases
      : mode === "token"
        ? tokenAliases
        : pageAliases;
  let inputToken: string | undefined;
  for (const param of parameters ?? []) {
    if (wanted.includes(param.name)) {
      inputToken = param.name;
      break;
    }
  }
  if (!inputToken) return undefined;

  // Items path: the first non-pagination array property at the top level.
  // For nested envelopes (e.g. `{ result: { items: [...] } }`) callers can
  // still hand-roll, but flat array fields like `projects`/`branches` work
  // automatically.
  let items: string | undefined;
  for (const [key, value] of Object.entries(outputProps)) {
    if (key === "pagination" || key === "next_token" || key === "NextToken")
      continue;
    let v = value;
    if (v.$ref) v = resolveRef(spec, v.$ref);
    if (v.type === "array") {
      items = key;
      break;
    }
  }
  if (!items) return undefined;

  return { mode, inputToken, outputToken, items };
}

const importPath = (specifier: string): string =>
  specifier.startsWith(".") && !specifier.endsWith(".ts")
    ? `${specifier}.ts`
    : specifier;

function buildOperationFile(
  method: OpenAPIHttpMethod,
  functionName: string,
  inputSchemaCode: string,
  inputSchemaName: string,
  outputSchemaCode: string,
  outputSchemaName: string,
  jsDoc: string,
  operationErrors: string[],
  sensitiveImports: {
    usesSensitiveString: boolean;
    usesSensitiveNullableString: boolean;
  },
  pagination:
    | {
        mode: "cursor" | "page" | "token";
        inputToken: string;
        outputToken: string;
        items: string;
      }
    | undefined,
  config: GeneratorConfig,
): string {
  const apiImport = config.apiImport ?? "@kevinmichaelchen/distilled/api";
  const schemaImport =
    config.schemaImport ?? "@kevinmichaelchen/distilled/schema";
  const traitsImport = config.traitsImport ?? `${config.importPrefix}/traits`;
  const protocolImport =
    config.protocolImport ?? `${config.importPrefix}/protocol`;
  const retryImport = config.retryImport ?? `${config.importPrefix}/retry`;
  const errorsImportPath =
    config.errorsImport ?? `${config.importPrefix}/errors`;

  const uniqueErrors = [...new Set(operationErrors)];
  const errorTypeName = `${toPascalCase(functionName)}Error`;
  const errorUnion = [...uniqueErrors, config.operationErrorType].join(" | ");
  const retryMethods = new Set(
    config.retryMethods ?? ["GET", "HEAD", "OPTIONS", "TRACE"],
  );
  const retries = retryMethods.has(
    method.toUpperCase() as UppercaseHttpMethod,
  );

  const factory = pagination ? "makePaginated" : "make";
  const operationType = pagination
    ? "PaginatedOperationMethod"
    : "OperationMethod";
  const selectedProtocol =
    pagination && config.paginatedProtocolName
      ? config.paginatedProtocolName
      : config.protocolName;
  const paginationLine = pagination
    ? `\n  pagination: { mode: "${pagination.mode}", inputToken: "${pagination.inputToken}", outputToken: "${pagination.outputToken}", items: "${pagination.items}" },`
    : "";
  const retryLine = retries
    ? `\n  retry: ${config.retryTag ?? "Retry.Retry"},`
    : "";

  const operationCode = `${jsDoc ? `${jsDoc}\n` : ""}export type ${errorTypeName} = ${errorUnion};
export const ${functionName}: API.${operationType}<
  ${inputSchemaName},
  ${outputSchemaName},
  ${errorTypeName},
  ${config.operationContextType}
> = /*@__PURE__*/ API.${factory}(() => ({
  input: ${inputSchemaName},
  output: ${outputSchemaName},
  errors: [${uniqueErrors.join(", ")}] as const,
  protocol: ${selectedProtocol},${retryLine}${paginationLine}
}));`;

  const protocolNames = [config.protocolName];
  if (
    config.paginatedProtocolName &&
    config.paginatedProtocolName !== config.protocolName
  ) {
    protocolNames.push(config.paginatedProtocolName);
  }
  let imports = `import * as S from "${importPath(schemaImport)}";
import * as API from "${importPath(apiImport)}";
import * as T from "${importPath(traitsImport)}";
import { ${protocolNames.join(", ")}, type ${config.operationErrorType}, type ${config.operationContextType} } from "${importPath(protocolImport)}";
import * as Retry from "${importPath(retryImport)}";`;

  if (uniqueErrors.length > 0) {
    imports += `\nimport { ${uniqueErrors.join(", ")} } from "${importPath(errorsImportPath)}";`;
  }

  const usesRedacted = Object.values(sensitiveImports).some(Boolean);
  if (usesRedacted) imports += `\nimport * as Redacted from "effect/Redacted";`;

  return [
    imports,
    "",
    "// Input Schema",
    inputSchemaCode,
    "",
    "// Output Schema",
    outputSchemaCode,
    "",
    "// The operation",
    operationCode,
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
