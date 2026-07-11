import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app.tsx";

const renderer = await createCliRenderer({ exitOnCtrlC: false });
const root = createRoot(renderer);
root.render(<App />);
