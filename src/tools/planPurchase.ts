import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, toolError } from "../util/result.js";

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
  description: "Return the ordered, end-to-end New Commerce purchase workflow (product -> SKU availability -> cart -> checkout -> subscriptions) with the exact REST scenario, method, path, and gotchas for each step.",
  inputShape: {
    customerId: z.string().optional(),
    country: z.string().optional(),
  },
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
      return {
        order: i + 1,
        scenarioId: s.id,
        title: s.title,
        method: s.method,
        path: fill(s.path),
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
