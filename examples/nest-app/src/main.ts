import type { LoadedCore } from "@ailura/colander";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { COLANDER_CORE } from "./colander/colander.constants.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Resolving the core here is proof at boot that the WebAssembly artifact
  // loaded, not merely that the Nest container started.
  const core = app.get<LoadedCore>(COLANDER_CORE);
  const version = core.versionInfo();
  Logger.log(
    `colander ${version.name}@${version.version} (ABI ${version.abi}) loaded`,
    "Bootstrap",
  );

  /**
   * The app is mounted at `/api`, and that is where the browser expects it.
   *
   * The documented contract has always been `/api/…` from the client, and the
   * react example's dev proxy was quietly making that true by stripping the
   * prefix before forwarding. That put the prefix in the proxy rather than in the
   * application, which meant the running app served `/definitions` while every
   * e2e spec mounted it with `setGlobalPrefix("api")` and therefore tested a
   * configuration the real boot never used — the specs could not catch the
   * mismatch because they were the ones introducing it.
   *
   * Setting it here makes the three agree, and it moves the decision to where it
   * belongs: the application owns its own path. A deployment behind a gateway
   * wants the prefix present anyway.
   */
  app.setGlobalPrefix("api");

  await app.listen(process.env.PORT ?? 3000);
}

try {
  await bootstrap();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  Logger.error(
    `Application failed to start: ${message}`,
    error instanceof Error ? error.stack : undefined,
    "Bootstrap",
  );
  process.exitCode = 1;
}
