import { colander } from "@ailura/colander";
import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { COLANDER_CORE } from "./colander.constants.js";
import { ColanderFilter } from "./colander.filter.js";
import { ColanderService } from "./colander.service.js";

@Module({
  providers: [
    {
      provide: COLANDER_CORE,
      useFactory: async () => colander.load(),
    },
    ColanderService,
    { provide: APP_FILTER, useClass: ColanderFilter },
  ],
  exports: [COLANDER_CORE, ColanderService],
})
export class ColanderModule {}
