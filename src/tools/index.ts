import type { Tool } from "../types.js";
import { listScenarios } from "./listScenarios.js";
import { getScenario } from "./getScenario.js";
import { searchDocs } from "./searchDocs.js";
import { authGuidance } from "./authGuidance.js";
import { checkAuth } from "./checkAuth.js";
import { generateCall } from "./generateCall.js";
import { migrateFromSdk } from "./migrateFromSdk.js";
import { lookupError } from "./lookupError.js";
import { diagnose } from "./diagnose.js";
import { getReference } from "./getReference.js";
import { validateRequest } from "./validateRequest.js";
import { planPurchase } from "./planPurchase.js";
import { getEnums } from "./getEnums.js";
import { whatsNew } from "./whatsNew.js";
import { getResource } from "./getResource.js";
import { buildRequest } from "./buildRequest.js";
import { decodeError } from "./decodeError.js";
import { planTransfer, planGdapOnboarding, planReconciliation } from "./planWorkflows.js";

export const allTools: Tool[] = [
  listScenarios, getScenario, searchDocs,
  authGuidance, checkAuth,
  generateCall, migrateFromSdk,
  lookupError, diagnose, getReference,
  validateRequest, planPurchase,
  getEnums, whatsNew, getResource,
  buildRequest, decodeError,
  planTransfer, planGdapOnboarding, planReconciliation,
];
