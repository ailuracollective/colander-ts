import { colander } from "@ailura/colander";
import { createRequestHandler } from "@tanstack/react-router/ssr/server";
import { defaultRenderHandler } from "@tanstack/react-start/server";
import { describe, expect, it, vi } from "vitest";

import { getRouter } from "./router";

describe("TanStack Start SSR boundary", () => {
  it("renders the index route shell without browser globals or WASM initialization", async () => {
    const load = vi.spyOn(colander, "load");

    try {
      const response = await createRequestHandler({
        createRouter: getRouter,
        request: new Request("http://localhost/"),
      })(defaultRenderHandler);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(html).toContain("<title>colander form runner</title>");
      expect(html).toContain("colander form runner");
      expect(html).toContain("HTTP /api");
      const headEnd = html.indexOf("</head>");
      const bootstrapStart = html.indexOf("prefers-color-scheme: dark");
      expect(headEnd).toBeGreaterThan(-1);
      expect(bootstrapStart).toBeGreaterThan(-1);
      expect(bootstrapStart).toBeLessThan(headEnd);
      expect(html).toContain("colander:theme");
      expect(html).toContain("classList.toggle");
      expect(globalThis.window).toBeUndefined();
      expect(globalThis.document).toBeUndefined();
      expect(load).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
    }
  });

  it("serves a known sample id and 404s an unknown one", async () => {
    const render = (pathname: string) =>
      createRequestHandler({
        createRouter: getRouter,
        request: new Request(`http://localhost${pathname}`),
      })(defaultRenderHandler);

    const known = await render("/samples/wasm-bmi");
    const knownHtml = await known.text();

    expect(known.status).toBe(200);
    expect(knownHtml).toContain("colander form runner");
    expect(knownHtml).not.toContain("The requested sample does not exist");

    const unknown = await render("/samples/definitely-not-a-sample");
    const unknownHtml = await unknown.text();

    expect(unknown.status).toBe(404);
    expect(unknownHtml).toContain("The requested sample does not exist");
    expect(unknownHtml).toContain("wasm-bmi");
  });
});
