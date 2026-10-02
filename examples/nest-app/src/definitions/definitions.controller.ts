import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from "@nestjs/common";

import type { FormDefinition, FormVersion } from "../db/forms.repository.js";
import { DefinitionsService } from "./definitions.service.js";
import type {
  CreateDefinitionBody,
  DefinitionDetail,
  DefinitionSummary,
  UpdateDefinitionBody,
  VersionDetail,
  VersionDocumentsBody,
  VersionSummary,
} from "./definitions.types.js";

/**
 * The definitions resource.
 *
 * Deliberately not under `forms`: `GET /forms/core` is registered before any
 * `GET /forms/:id` would be, and would swallow it. The transport only moves
 * ids around; every rule — a draft stored as received, publication validated by
 * the core, published rows immutable — lives in the service and, below it, in
 * the repository and the database.
 */
@Controller("definitions")
export class DefinitionsController {
  constructor(private readonly definitions: DefinitionsService) {}

  @Get()
  list(): Promise<DefinitionSummary[]> {
    return this.definitions.list();
  }

  @Post()
  create(@Body() body: CreateDefinitionBody): Promise<FormDefinition> {
    return this.definitions.create(body);
  }

  @Get(":id")
  get(@Param("id") id: string): Promise<DefinitionDetail> {
    return this.definitions.get(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: UpdateDefinitionBody): Promise<FormDefinition> {
    return this.definitions.update(id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string): Promise<boolean> {
    return this.definitions.remove(id);
  }

  @Post(":id/versions")
  createDraft(
    @Param("id") id: string,
    @Body() body: VersionDocumentsBody,
  ): Promise<FormVersion> {
    return this.definitions.createDraft(id, body);
  }

  @Get(":id/versions")
  listVersions(@Param("id") id: string): Promise<VersionSummary[]> {
    return this.definitions.listVersions(id);
  }

  @Get(":id/published")
  published(@Param("id") id: string): Promise<FormVersion> {
    return this.definitions.published(id);
  }

  @Get(":id/versions/:versionId")
  getVersion(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
  ): Promise<VersionDetail> {
    return this.definitions.getVersion(id, versionId);
  }

  @Patch(":id/versions/:versionId")
  updateDraft(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @Body() body: VersionDocumentsBody,
  ): Promise<FormVersion> {
    return this.definitions.updateDraft(id, versionId, body);
  }

  @Delete(":id/versions/:versionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDraft(@Param("id") id: string, @Param("versionId") versionId: string): Promise<boolean> {
    return this.definitions.deleteDraft(id, versionId);
  }

  /**
   * Publication is not a creation: the version already exists, so it answers
   * 200 with the frozen row rather than 201.
   */
  @Post(":id/versions/:versionId/publish")
  @HttpCode(HttpStatus.OK)
  publish(@Param("id") id: string, @Param("versionId") versionId: string): Promise<FormVersion> {
    return this.definitions.publish(id, versionId);
  }

  @Post(":id/versions/:versionId/clone")
  clone(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @Body() body: VersionDocumentsBody,
  ): Promise<FormVersion> {
    return this.definitions.clone(id, versionId, body);
  }
}
