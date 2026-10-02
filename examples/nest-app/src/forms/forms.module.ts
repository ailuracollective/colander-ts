import { Module } from "@nestjs/common";

import { ColanderModule } from "../colander/colander.module.js";
import { FormsController } from "./forms.controller.js";
import { FormsService } from "./forms.service.js";

@Module({
  imports: [ColanderModule],
  controllers: [FormsController],
  providers: [FormsService],
})
export class FormsModule {}
