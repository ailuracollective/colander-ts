import { Module } from "@nestjs/common";

import { ColanderModule } from "../colander/colander.module.js";
import { DbModule } from "../db/db.module.js";
import { ResponsesController } from "./responses.controller.js";
import { ResponsesService } from "./responses.service.js";

/**
 * The responses resource needs both halves of the application: the database for
 * storage and the core for the validation whose result the stored row carries.
 */
@Module({
  imports: [DbModule, ColanderModule],
  controllers: [ResponsesController],
  providers: [ResponsesService],
})
export class ResponsesModule {}
