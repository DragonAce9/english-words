import { PostHogProvider } from "@posthog/react";
import posthog from "posthog-js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { analyticsEnabled, initAnalytics } from "./analytics";
import { App } from "./App";
import { bootTelegram } from "./telegram";
import "./styles.css";

bootTelegram();
initAnalytics();

const app = <App />;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {analyticsEnabled() ? <PostHogProvider client={posthog}>{app}</PostHogProvider> : app}
  </StrictMode>,
);
