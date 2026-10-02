import { Module } from "@nestjs/common";

import { ColanderModule } from "./colander/colander.module.js";
import { DefinitionsModule } from "./definitions/definitions.module.js";
import { FormsModule } from "./forms/forms.module.js";
import { ResponsesModule } from "./responses/responses.module.js";

@Module({
  imports: [ColanderModule, FormsModule, DefinitionsModule, ResponsesModule],
})
export class AppModule {}
