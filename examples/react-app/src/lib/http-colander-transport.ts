import {
  ColanderTransportError,
  isColanderTransportErrorKind,
  toColanderTransportError,
  type ColanderFailureBody,
  type ColanderTransport,
  type ColanderTransportErrorKind,
  type CompileRequest,
  type CompiledForm,
  type ContentHashRequest,
  type CoreInfo,
  type DescribeFormRequest,
  type DescribedField,
  type DescribedForm,
  type EvaluateRulesRequest,
  type NextVersionRequest,
  type ResponseValidation,
  type RuleEvaluation,
  type SchemaCheck,
  type ValidateResponseRequest,
  type ValidateSchemaRequest,
} from "@ailura/colander-client";

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

/** HTTP uses the same neutral category union as every other adapter. */
export type ApiErrorKind = ColanderTransportErrorKind;

/** Error raised by this source-specific adapter. */
export class ColanderApiError extends ColanderTransportError<ApiErrorKind> {
  readonly status?: number;

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: { detail?: string; status?: number; cause?: unknown } = {},
  ) {
    super(message, {
      kind,
      ...(options.detail === undefined ? {} : { detail: options.detail }),
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = "ColanderApiError";
    this.status = options.status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorBody(value: unknown): value is ColanderFailureBody {
  return (
    isRecord(value) &&
    isColanderTransportErrorKind(value.kind) &&
    typeof value.message === "string" &&
    (value.detail === undefined || typeof value.detail === "string")
  );
}

function safeParse(text: string): unknown {
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function malformedSuccess(path: string, detail: string): ColanderApiError {
  return new ColanderApiError("operation", `Malformed successful response from ${path}.`, {
    detail,
  });
}

function parseCoreInfo(body: unknown, path: string): CoreInfo {
  if (
    !isRecord(body) ||
    typeof body.abiVersion !== "number" ||
    !isRecord(body.versionInfo) ||
    typeof body.versionInfo.name !== "string" ||
    typeof body.versionInfo.version !== "string" ||
    typeof body.versionInfo.abi !== "number"
  ) {
    throw malformedSuccess(path, "Expected an object with abiVersion and versionInfo.");
  }
  return body as unknown as CoreInfo;
}

function parseStringResult(body: unknown, path: string): string {
  if (typeof body !== "string") {
    throw malformedSuccess(path, "Expected a JSON string response.");
  }
  return body;
}

function parseCompiledForm(body: unknown, path: string): CompiledForm {
  if (
    !isRecord(body) ||
    typeof body.formSchemaJson !== "string" ||
    (body.uiSchemaJson !== null && typeof body.uiSchemaJson !== "string") ||
    (body.rulesSchemaJson !== null && typeof body.rulesSchemaJson !== "string") ||
    typeof body.dependencyMetadataJson !== "string" ||
    typeof body.contentHash !== "string"
  ) {
    throw malformedSuccess(path, "Expected a compiled form result.");
  }
  return body as unknown as CompiledForm;
}

function parseDescribedForm(body: unknown, path: string): DescribedForm {
  if (!isRecord(body) || !Array.isArray(body.fields) || typeof body.contentHash !== "string") {
    throw malformedSuccess(path, "Expected a described form result.");
  }
  const fields: DescribedField[] = body.fields.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.code !== "string" ||
      typeof entry.path !== "string" ||
      (entry.parentPath !== null && typeof entry.parentPath !== "string") ||
      typeof entry.type !== "string" ||
      typeof entry.required !== "boolean" ||
      typeof entry.readOnly !== "boolean"
    ) {
      throw malformedSuccess(path, `Expected a described field at fields[${index}].`);
    }
    return entry as unknown as DescribedField;
  });
  return { fields, contentHash: body.contentHash };
}

function parseRuleEvaluation(body: unknown, path: string): RuleEvaluation {
  if (
    !isRecord(body) ||
    !isRecord(body.visibility) ||
    !isRecord(body.enabled) ||
    !isRecord(body.required) ||
    !isRecord(body.calculatedValues) ||
    !Array.isArray(body.validationErrors) ||
    !body.validationErrors.every(
      (entry) =>
        isRecord(entry) && typeof entry.code === "string" && typeof entry.message === "string",
    )
  ) {
    throw malformedSuccess(path, "Expected a rule evaluation result.");
  }
  return body as unknown as RuleEvaluation;
}

function parseResponseValidation(body: unknown, path: string): ResponseValidation {
  if (
    !isRecord(body) ||
    typeof body.normalizedAnswersJson !== "string" ||
    typeof body.isValid !== "boolean" ||
    !Array.isArray(body.errors) ||
    !body.errors.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.code === "string" &&
        typeof entry.path === "string" &&
        typeof entry.message === "string",
    )
  ) {
    throw malformedSuccess(path, "Expected a response validation result.");
  }
  return body as unknown as ResponseValidation;
}

function parseSchemaCheck(body: unknown, path: string): SchemaCheck {
  if (!isRecord(body) || typeof body.valid !== "boolean") {
    throw malformedSuccess(path, "Expected a schema check result.");
  }
  if (body.valid === false && typeof body.message !== "string") {
    throw malformedSuccess(path, "An invalid schema check must include a message.");
  }
  return body as unknown as SchemaCheck;
}

async function request<T>(
  path: string,
  parse: (body: unknown, path: string) => T,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ColanderApiError(
      "network",
      `Could not reach the colander backend at ${API_BASE}. ${reason}`,
      { cause: error },
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ColanderApiError(
      "network",
      `Could not read the colander backend response. ${reason}`,
      {
        cause: error,
      },
    );
  }

  const body = safeParse(text);
  if (!response.ok) {
    const record = isErrorBody(body) ? body : undefined;
    const kind = record?.kind ?? (response.status >= 500 ? "operation" : "invalid_request");
    const message = record?.message ?? `Request failed with HTTP ${response.status}.`;
    const detail = record?.detail;
    throw new ColanderApiError(kind, message, {
      ...(detail === undefined ? {} : { detail }),
      status: response.status,
    });
  }

  return parse(body, path);
}

/** The React example's source-specific adapter for the Colander service. */
export const httpColanderTransport: ColanderTransport = {
  getCore: () => request("/forms/core", parseCoreInfo),
  compile: (body: CompileRequest) =>
    request("/forms/compile", parseCompiledForm, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  describeForm: (body: DescribeFormRequest) =>
    request("/forms/describe-form", parseDescribedForm, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  contentHash: (body: ContentHashRequest) =>
    request("/forms/content-hash", parseStringResult, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  evaluateRules: (body: EvaluateRulesRequest) =>
    request("/forms/evaluate-rules", parseRuleEvaluation, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  validateResponse: (body: ValidateResponseRequest) =>
    request("/forms/validate-response", parseResponseValidation, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  validateSchema: (body: ValidateSchemaRequest) =>
    request("/forms/validate-schema", parseSchemaCheck, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  nextVersion: (body: NextVersionRequest = {}) =>
    request("/forms/next-version", parseStringResult, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

/** Narrow any thrown value to the source-specific error used by the UI. */
export function toColanderApiError(error: unknown): ColanderApiError {
  if (error instanceof ColanderApiError) {
    return error;
  }
  if (error instanceof ColanderTransportError) {
    return new ColanderApiError(error.kind, error.message, {
      ...(error.detail === undefined ? {} : { detail: error.detail }),
      cause: error,
    });
  }
  if (isColanderTransportErrorKind((error as { kind?: unknown } | null)?.kind)) {
    const normalized = toColanderTransportError(error);
    return new ColanderApiError(normalized.kind, normalized.message, {
      ...(normalized.detail === undefined ? {} : { detail: normalized.detail }),
      cause: error,
    });
  }
  if (error instanceof Error) {
    return new ColanderApiError("network", error.message, { cause: error });
  }
  return new ColanderApiError("network", String(error), { cause: error });
}
