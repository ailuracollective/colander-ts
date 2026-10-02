import { createRouter } from "@tanstack/react-router";

import SampleNotFound from "./components/sample-not-found";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultNotFoundComponent: SampleNotFound,
    scrollRestoration: true,
  });
}
