import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, toolError } from "../util/result.js";
import { envelope, OFFLINE, PlanData } from "../util/schema.js";
import { baseUrlFor } from "../knowledge/apis.js";

// The ordered scenarios that make up an end-to-end New Commerce purchase, with
// the reason each step exists. Scenario detail (method/path/docUrl) is pulled
// live from the knowledge pack so it never drifts from the rest of the data.
const CHAIN: { scenarioId: string; why: string }[] = [
  { scenarioId: "get-products", why: "Find the product to buy for the customer's country and target view (use OnlineServices for NCE)." },
  { scenarioId: "get-sku-availabilities", why: "Get a FRESH CatalogItemId for the chosen SKU right before ordering — it is reissued regularly." },
  { scenarioId: "create-cart", why: "Add line items (catalogItemId, quantity, termDuration, billingCycle). Carts expire after 7 days." },
  { scenarioId: "checkout-cart", why: "Check out to create the order. Provisioning is asynchronous; subscriptionIds may not be in the response yet." },
  { scenarioId: "get-subscriptions-by-order", why: "Resolve the order into provisioned Subscription(s) (allow up to ~15 min after checkout)." },
  { scenarioId: "update-subscription", why: "Optional: adjust quantity, status, or autorenew after provisioning (send the FULL resource)." },
];

export const planPurchase: Tool = {
  name: "pc_plan_purchase",
  title: "Plan an NCE purchase",
  description:
    "Return the ordered end-to-end New Commerce purchase workflow — find the product, get a fresh SKU availability, build the cart, check out, resolve the provisioned subscriptions — with the exact operation, resolved URL, and key gotchas for each step. " +
    "Use this to buy new subscriptions for a customer. To move existing subscriptions between partners use pc_plan_transfer, and to link the customer to your account first use pc_plan_csp_onboarding. " +
    "Planning only: nothing is executed, no Partner Center credentials are used, and no network call is made — it is a lookup over the bundled scenario pack. " +
    "Returns { goal, steps[] with order/scenarioId/method/path/url/authType/why/keyGotchas/docUrl, notes[] }. " +
    "Pass any step's scenarioId to pc_generate_call for runnable code.",
  inputShape: {
    customerId: z.string().optional().describe(
      "Optional Partner Center customer tenant id (GUID, e.g. \"c7f6e4b1-3a2d-4c5e-9f80-1b2c3d4e5f60\"). " +
      "Substituted for the {customer-id} placeholder in every step's path and url so the plan comes back ready to run. Omit to keep the placeholders.",
    ),
    country: z.string().optional().describe(
      "Optional two-letter ISO 3166-1 country code for the customer's market, e.g. \"TR\", \"DE\", \"US\". " +
      "Substituted for the {country} placeholder in the catalog steps, since product availability and pricing are market-specific. Omit to keep the placeholder.",
    ),
  },
  outputShape: envelope(PlanData),
  annotations: OFFLINE,
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const fill = (path: string) => {
      let p = path;
      if (args.customerId) p = p.replace("{customer-id}", args.customerId);
      if (args.country) p = p.replace("{country}", args.country);
      return p;
    };
    const steps = CHAIN.map((step, i) => {
      const s = k.scenarios.find((x) => x.id === step.scenarioId);
      if (!s) return null;
      // `url` resolves the api-relative `path` against its base so a step
      // targeting Graph is not mistaken for a Partner Center route.
      const path = fill(s.path);
      return {
        order: i + 1,
        scenarioId: s.id,
        title: s.title,
        method: s.method,
        path,
        url: baseUrlFor(s.api) + path,
        authType: s.authType,
        why: step.why,
        keyGotchas: s.gotchas.slice(0, 2),
        docUrl: s.docUrl,
      };
    }).filter(Boolean);

    if (steps.length === 0) return toolError("Purchase-chain scenarios are missing from the knowledge pack.");

    return ok({
      goal: "Purchase a New Commerce (NCE) offer for a customer end to end.",
      steps,
      notes: [
        "All steps use an App+User token with audience https://api.partnercenter.microsoft.com.",
        "Re-fetch the availability (step 2) immediately before create-cart so the CatalogItemId is current.",
        "Place promotion-eligible (New-To-Offer) line items first when multiple same-type items are in one cart.",
        "Use pc_generate_call <scenarioId> for ready code for any step, and pc_lookup_error to decode failures.",
      ],
    });
  },
};
