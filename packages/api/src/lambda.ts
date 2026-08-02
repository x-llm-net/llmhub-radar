import { edgeRouterEntries } from "./edge";
import { apiKeyRouter } from "./router/apiKey";
import { blobRouter } from "./router/blob";
import { emailRouter } from "./router/email";
import { hubRouter } from "./router/hub";
import { integrationRouter } from "./router/integration";
import { radarRouter } from "./router/radar";
import { statusPageRouter } from "./router/statusPage";
import { stripeRouter } from "./router/stripe";
import { createTRPCRouter } from "./trpc";

const lambdaRouterEntries = {
  stripeRouter: stripeRouter,
  emailRouter: emailRouter,
  apiKeyRouter: apiKeyRouter,
  integrationRouter: integrationRouter,
  hub: hubRouter,
  blob: blobRouter,
  radar: radarRouter,
  statusPage: statusPageRouter,
};

// Deployed to /trpc/lambda/**
export const lambdaRouter = createTRPCRouter(
  process.env.NODE_ENV === "development"
    ? { ...edgeRouterEntries, ...lambdaRouterEntries }
    : lambdaRouterEntries,
);

export { stripe } from "./router/stripe/shared";
