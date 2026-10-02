import { ColanderError } from "@ailura/colander";
import type { ColanderErrorKind } from "@ailura/colander";
import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import type { Response } from "express";

/** The structured body every colander failure returns. */
interface ColanderErrorBody {
  kind: ColanderErrorKind;
  message: string;
  detail?: string;
}

function statusFor(kind: ColanderErrorKind): number {
  // `validation` is the ordinary "no" from the core and is the caller's to
  // fix. `invalid_request` is a bug in the binding and `panic` is a bug in the
  // core; neither is a caller error, so both surface as server errors.
  return kind === "validation" ? HttpStatus.BAD_REQUEST : HttpStatus.INTERNAL_SERVER_ERROR;
}

function reasonFor(kind: ColanderErrorKind): string | undefined {
  if (kind === "invalid_request") {
    return "The request envelope was unusable; this is a bug in the binding, not in the caller data.";
  }
  if (kind === "panic") {
    return "The WebAssembly instance is retired after a trap and must be reloaded with colander.load().";
  }
  return undefined;
}

/**
 * Maps a `ColanderError` onto HTTP without leaking the core's failure kind into
 * the status code: only `validation` is a 400.
 */
@Catch(ColanderError)
export class ColanderFilter implements ExceptionFilter {
  catch(exception: ColanderError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body: ColanderErrorBody = {
      kind: exception.kind,
      message: exception.message,
    };
    const detail = reasonFor(exception.kind);
    if (detail !== undefined) {
      body.detail = detail;
    }
    response.status(statusFor(exception.kind)).json(body);
  }
}
