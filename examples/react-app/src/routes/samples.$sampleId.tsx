import { createFileRoute, notFound } from "@tanstack/react-router";

import App from "../App";
import { findSampleOrUndefined } from "../samples";

export const Route = createFileRoute("/samples/$sampleId")({
  beforeLoad: ({ params }) => {
    // Thrown from beforeLoad so the boundary is resolved before rendering: an
    // unknown id is a not-found, never a silent fallback to another sample.
    if (findSampleOrUndefined(params.sampleId) === undefined) {
      throw notFound();
    }
  },
  component: SampleRoute,
});

function SampleRoute() {
  const { sampleId } = Route.useParams();

  return <App sampleId={sampleId} />;
}
