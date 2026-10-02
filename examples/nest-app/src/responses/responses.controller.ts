import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";

import type { FormResponse } from "../db/forms.repository.js";
import { ResponsesService } from "./responses.service.js";
import type { SubmitResponseBody } from "./responses.types.js";

/**
 * The responses resource.
 *
 * Deliberately not under `forms`: `GET /forms/core` is registered before any
 * `GET /forms/:id` would be, and would swallow it. The transport only moves
 * ids around; every rule — the core validates before the write, the row is
 * stored either way, only a published version of its own form may accept
 * responses — lives in the service and, below it, in the repository and the
 * database.
 */
@Controller("responses")
export class ResponsesController {
  constructor(private readonly responses: ResponsesService) {}

  /**
   * 201 means "recorded", not "accepted": an invalid answer set is stored with
   * the core's verdict on it rather than refused.
   */
  @Post()
  submit(@Body() body: SubmitResponseBody): Promise<FormResponse> {
    return this.responses.submit(body);
  }

  /** The form is a query parameter; see the note on the service method. */
  @Get()
  list(@Query("formId") formId: string): Promise<FormResponse[]> {
    return this.responses.list(formId);
  }

  @Get(":id")
  get(@Param("id") id: string): Promise<FormResponse> {
    return this.responses.get(id);
  }
}
