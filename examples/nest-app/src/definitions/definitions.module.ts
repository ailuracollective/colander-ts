import { Module } from "@nestjs/common";

import { ColanderModule } from "../colander/colander.module.js";
import { DbModule } from "../db/db.module.js";
import { DefinitionsController } from "./definitions.controller.js";
import { DefinitionsService } from "./definitions.service.js";

/**
 * The definitions resource needs both halves of the application: the database
 * for storage and the core for the publication gate and the live `schemaCheck`.
 */
@Module({
  imports: [DbModule, ColanderModule],
  controllers: [DefinitionsController],
  providers: [DefinitionsService],
})
export class DefinitionsModule {}
