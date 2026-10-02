import { createFileRoute } from "@tanstack/react-router";

import App from "../App";
import { DEFAULT_SAMPLE_ID } from "../samples";

export const Route = createFileRoute("/")({
  component: () => <App sampleId={DEFAULT_SAMPLE_ID} />,
});
