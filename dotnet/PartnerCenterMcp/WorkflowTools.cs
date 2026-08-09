using System.ComponentModel;
using System.Text.Json;
using System.Text.RegularExpressions;
using ModelContextProtocol.Server;

namespace PartnerCenterMcp;

[McpServerToolType]
public static class AuthLintTools
{
    private record Rule(string Pattern, string Severity, string Message, string Fix, string DocUrl);

    private static readonly Rule[] Rules =
    {
        new(@"graph\.windows\.net", "error", "Uses the retired graph.windows.net audience; Partner Center returns 401 / 900420.", "Request the token with resource https://api.partnercenter.microsoft.com.", "https://learn.microsoft.com/partner-center/developer/deprecate-azure-active-directory-graph-token"),
        new(@"AuthenticationContext|ActiveDirectory\.Library|\bADAL\b", "warning", "Appears to use ADAL, which is deprecated.", "Use MSAL with the secure application model.", "https://learn.microsoft.com/partner-center/developer/enable-secure-app-model"),
        new(@"IAggregatePartner|PartnerService\.Instance|partner-center-sdk|Microsoft\.Store\.PartnerCenter", "warning", "References the archived Partner Center .NET SDK (3.4.0, archived June 2023).", "Call the Partner Center REST APIs directly; use pc_migrate_from_sdk to translate.", "https://learn.microsoft.com/partner-center/developer/get-started"),
        new(@"Install-Module\s+(AzureAD|MSOnline)|Connect-AzureAD|Connect-MsolService", "warning", "Uses the deprecated AzureAD/MSOnline PowerShell modules.", "Use the Microsoft.Graph PowerShell module with the secure application model.", "https://learn.microsoft.com/partner-center/developer/enable-secure-app-model"),
    };

    [McpServerTool(Name = "pc_check_auth"), Description("Lint a Partner Center auth/client snippet for retired patterns (graph.windows.net, ADAL, archived SDK, AzureAD PS) and return fixes.")]
    public static object CheckAuth([Description("code snippet to lint")] string code)
    {
        var findings = Rules.Where(r => Regex.IsMatch(code, r.Pattern, RegexOptions.IgnoreCase))
            .Select(r => new { pattern = r.Pattern, severity = r.Severity, message = r.Message, fix = r.Fix, docUrl = r.DocUrl })
            .ToList();
        return new { findings, clean = findings.Count == 0 };
    }

    [McpServerTool(Name = "pc_decode_error"), Description("Paste a Partner Center error response (JSON or text). Decodes the error code with causes + remediation, links scenarios, and surfaces the correlation id.")]
    public static object DecodeError([Description("error JSON or text")] string error)
    {
        var raw = error ?? "";
        string? code = null; int? httpStatus = null;
        try
        {
            var j = JsonDocument.Parse(raw).RootElement;
            foreach (var k in new[] { "errorCode", "code" })
                if (j.TryGetProperty(k, out var v)) { code = v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString(); break; }
            if (code is null && j.TryGetProperty("error", out var e) && e.TryGetProperty("code", out var ec)) code = ec.GetString();
            foreach (var k in new[] { "httpStatus", "status", "statusCode" })
                if (j.TryGetProperty(k, out var v) && v.TryGetInt32(out var n)) { httpStatus = n; break; }
        }
        catch { /* not JSON */ }
        code ??= Regex.Match(raw, @"\b(9\d{5}|\d{4,6})\b").Groups[1].Value is { Length: > 0 } c ? c : null;
        if (httpStatus is null) { var ms = Regex.Match(raw, @"\b(4\d{2}|5\d{2})\b"); if (ms.Success) httpStatus = int.Parse(ms.Groups[1].Value); }
        var corr = Regex.Match(raw, @"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

        var match = code is null ? null : Knowledge.Current.Errors.FirstOrDefault(x => x.ErrorCode == code);
        var related = (match?.RelatedScenarios ?? new()).Select(id => Knowledge.Current.Scenarios.FirstOrDefault(s => s.Id == id))
            .Where(s => s is not null).Select(s => new { s!.Id, s.Title, s.DocUrl });

        return new
        {
            parsed = new { code, httpStatus, correlationId = corr.Success ? corr.Value : null },
            match,
            relatedScenarios = related,
            correlationGuidance = corr.Success
                ? $"Quote MS-CorrelationId {corr.Value} when opening a Partner Center support request."
                : "No correlation id found; capture the MS-CorrelationId response header for support.",
        };
    }

    [McpServerTool(Name = "pc_validate_request"), Description("Lint a Partner Center REST call (method, URL, headers, auth) against the known scenarios.")]
    public static object ValidateRequest(
        [Description("GET|POST|PUT|PATCH|DELETE|HEAD")] string method,
        [Description("request URL or path")] string url,
        [Description("app-only or app+user (optional)")] string? authType = null,
        [Description("present header names->values (optional)")] Dictionary<string, string>? headers = null)
    {
        var hdrs = headers ?? new();
        bool HasHeader(string n) => hdrs.Keys.Any(h => h.Equals(n, StringComparison.OrdinalIgnoreCase));
        var path = Regex.Replace(url.Trim(), @"^https?://[^/]+", "");
        if (!path.StartsWith("/")) path = "/" + path;

        bool PathMatches(string scenarioPath)
        {
            var sp = scenarioPath.Split('?')[0].Split('/', StringSplitOptions.RemoveEmptyEntries);
            var ip = path.Split('?')[0].Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (sp.Length != ip.Length) return false;
            for (int i = 0; i < sp.Length; i++)
            {
                var seg = sp[i];
                if (seg.StartsWith("{") && seg.EndsWith("}")) continue;
                if (!seg.Equals(ip[i], StringComparison.OrdinalIgnoreCase)) return false;
            }
            return true;
        }

        var samePath = Knowledge.Current.Scenarios.Where(s => PathMatches(s.Path)).ToList();
        var matched = samePath.FirstOrDefault(s => s.Method.Equals(method, StringComparison.OrdinalIgnoreCase));
        var findings = new List<object>();

        if (samePath.Count == 0)
            findings.Add(new { severity = "info", message = $"No known scenario matches the path {path}. It may still be valid; check pc_list_scenarios." });
        else if (matched is null)
        {
            var methods = string.Join(", ", samePath.Select(s => s.Method).Distinct());
            findings.Add(new { severity = "error", message = $"Path matches a known scenario but method {method} is wrong; expected {methods}.", fix = $"Use {methods} for {samePath[0].Path}." });
        }

        if (matched is not null)
        {
            if (authType == "app-only" && matched.AuthType == "app+user")
                findings.Add(new { severity = "error", message = $"Scenario \"{matched.Id}\" does not support app-only authentication.", fix = "Use an App+User (secure application model) token." });
            if (!HasHeader("authorization"))
                findings.Add(new { severity = "error", message = "Missing Authorization header.", fix = "Add Authorization: Bearer <token> (audience https://api.partnercenter.microsoft.com)." });
            if (new[] { "POST", "PUT", "PATCH", "DELETE" }.Contains(matched.Method) && !HasHeader("ms-requestid"))
                findings.Add(new { severity = "warning", message = "Write operation without MS-RequestId.", fix = "Add a unique MS-RequestId and reuse it on retries for idempotency." });
        }
        else if (!HasHeader("authorization"))
            findings.Add(new { severity = "error", message = "Missing Authorization header.", fix = "Add Authorization: Bearer <token>." });

        foreach (var kv in hdrs)
            if (Regex.IsMatch(kv.Value, "graph\\.windows\\.net", RegexOptions.IgnoreCase))
                findings.Add(new { severity = "error", message = $"Header {kv.Key} references the retired graph.windows.net audience (401 / 900420).", fix = "Request the token with resource https://api.partnercenter.microsoft.com." });

        var hasError = findings.Any(f => f.GetType().GetProperty("severity")!.GetValue(f)!.ToString() == "error");
        return new
        {
            ok = !hasError,
            matched = matched is null ? null : new { matched.Id, matched.Title, matched.Method, matched.Path, matched.AuthType, matched.DocUrl },
            findings,
        };
    }
}

[McpServerToolType]
public static class WorkflowTools
{
    private static object BuildPlan(string? customerId, (string id, string why)[] chain, string goal, string[] notes)
    {
        var steps = new List<object>();
        int order = 1;
        foreach (var (id, why) in chain)
        {
            var s = Knowledge.Current.Scenarios.FirstOrDefault(x => x.Id == id);
            if (s is null) continue;
            var pathFilled = customerId is null ? s.Path : s.Path.Replace("{customer-id}", customerId);
            steps.Add(new { order = order++, scenarioId = s.Id, s.Title, s.Method, path = pathFilled, s.AuthType, why, keyGotchas = s.Gotchas.Take(2), s.DocUrl });
        }
        return new { goal, steps, notes };
    }

    [McpServerTool(Name = "pc_plan_purchase"), Description("The ordered New Commerce purchase workflow: product -> SKU availability -> cart -> checkout -> subscriptions.")]
    public static object PlanPurchase([Description("customer id (optional)")] string? customerId = null) => BuildPlan(customerId, new[]
    {
        ("get-products", "Find the product for the customer's country and target view (OnlineServices for NCE)."),
        ("get-sku-availabilities", "Get a FRESH CatalogItemId right before ordering."),
        ("create-cart", "Add line items (catalogItemId, quantity, termDuration, billingCycle). Carts expire after 7 days."),
        ("checkout-cart", "Check out to create the order; provisioning is asynchronous."),
        ("get-subscriptions-by-order", "Resolve the order into provisioned subscription(s)."),
        ("update-subscription", "Optional: adjust quantity/status/autorenew after provisioning."),
    }, "Purchase a New Commerce (NCE) offer for a customer end to end.", new[]
    {
        "All steps use an App+User token with audience https://api.partnercenter.microsoft.com.",
        "Re-fetch availability right before create-cart so the CatalogItemId is current.",
    });

    [McpServerTool(Name = "pc_plan_transfer"), Description("The ordered New Commerce transfer (billing-ownership) workflow.")]
    public static object PlanTransfer([Description("customer id (optional)")] string? customerId = null) => BuildPlan(customerId, new[]
    {
        ("create-transfer", "TARGET (new) partner creates the NCE transfer (transferType 3)."),
        ("get-transfer", "Poll status (Pending -> InProgress -> Complete); source partner submits on their side."),
        ("list-customer-subscriptions", "After completion, verify the transferred subscriptions."),
    }, "Move a customer's New Commerce subscriptions to a new partner of record.", new[]
    {
        "All steps use an App+User token (Admin agent).",
        "Only NewCommerce (transferType 3) is supported here.",
    });

    [McpServerTool(Name = "pc_plan_gdap_onboarding"), Description("The ordered GDAP onboarding workflow (create -> approve -> verify) across Microsoft Graph.")]
    public static object PlanGdapOnboarding([Description("customer id (optional)")] string? customerId = null) => BuildPlan(customerId, new[]
    {
        ("create-gdap-relationship", "Create the relationship (Graph) with the needed Entra roles + duration."),
        ("get-gdap-relationship-by-id", "After lockForApproval and the customer approving, poll until status is active."),
        ("get-gdap-relationships", "Confirm the active relationship in the partner's GDAP list."),
    }, "Establish granular delegated admin (GDAP) access to a customer tenant.", new[]
    {
        "Microsoft Graph APIs (audience https://graph.microsoft.com, scope DelegatedAdminRelationship.ReadWrite.All).",
        "Between create and verify: POST a relationshipRequest (lockForApproval), customer approves, then create accessAssignments.",
    });

    [McpServerTool(Name = "pc_plan_reconciliation"), Description("The ordered invoice reconciliation workflow (invoice -> billed/unbilled line items -> statement).")]
    public static object PlanReconciliation([Description("unused (optional)")] string? customerId = null) => BuildPlan(null, new[]
    {
        ("get-invoices", "Find the invoice for the billing period."),
        ("get-invoice-by-id", "Read totals and per-provider links to line items."),
        ("get-invoice-billed-lineitems", "Pull billed reconciliation line items (paged)."),
        ("get-invoice-unbilled-lineitems", "Pull unbilled (current/previous) line items."),
        ("get-invoice-statement", "Download the invoice statement PDF."),
    }, "Reconcile a billing period: invoice, line items, and statement.", new[]
    {
        "For new-commerce recon after the v1 cutoffs, prefer the async v2 Graph exports.",
        "See pc_whats_new for the v1->v2 reconciliation deadlines.",
    });

    [McpServerTool(Name = "pc_plan_csp_onboarding"), Description("The ordered CSP customer onboarding (account linking) workflow: invite -> verify relationship -> confirm agreement -> transact.")]
    public static object PlanCspOnboarding([Description("customer id (optional)")] string? customerId = null) => BuildPlan(customerId, new[]
    {
        ("get-reseller-relationship-url", "Get the invitation URL and send it to the customer's global admin."),
        ("get-customer-by-id", "Once accepted, confirm relationshipToPartner is reseller."),
        ("get-agreement-metadata", "Read the current MCA templateId; a superseded template is rejected."),
        ("create-agreement", "Record the customer's acceptance of the Microsoft Customer Agreement."),
        ("get-agreements", "Verify the attestation is on record before transacting."),
    }, "Link an existing customer tenant to the partner and make it transactable.", new[]
    {
        "All steps use an App+User token with audience https://api.partnercenter.microsoft.com.",
        "A customer who signed the MCA directly with Microsoft needs no attestation - check get-direct-sign-status first.",
        "Transacting before the agreement is recorded fails; 800075 means the account is still under review.",
    });

    [McpServerTool(Name = "pc_plan_user_onboarding"), Description("The ordered user onboarding workflow: check licences -> create user -> assign licences -> grant roles -> verify.")]
    public static object PlanUserOnboarding([Description("customer id (optional)")] string? customerId = null) => BuildPlan(customerId, new[]
    {
        ("get-subscribed-skus", "Check the customer has an available seat before creating anyone."),
        ("create-user", "Create the account; the response carries the one-time password."),
        ("assign-licenses", "Assign the SKU; licences are not granted by creating the user."),
        ("assign-user-role", "Grant any directory role the user needs."),
        ("get-user-licenses", "Verify what actually landed on the account."),
    }, "Onboard a user into a customer tenant with licences and roles.", new[]
    {
        "The user's UPN must use a domain registered on the tenant - see get-customer-custom-domains.",
        "The password is returned once, on create. It cannot be read back.",
        "Group-based licensing assigns through the group instead; see assign-group-license.",
    });

    [McpServerTool(Name = "pc_plan_user_offboarding"), Description("The ordered user offboarding workflow: read licences -> reclaim them -> strip roles -> delete (30-day restore window).")]
    public static object PlanUserOffboarding([Description("customer id (optional)")] string? customerId = null) => BuildPlan(customerId, new[]
    {
        ("get-user-licenses", "See what the account holds before removing anything."),
        ("assign-licenses", "Reclaim the licences with licensesToRemove so the seats free up."),
        ("get-user-roles", "Find any directory role the account still holds."),
        ("remove-user-role", "Strip elevated roles before deletion."),
        ("delete-user", "Delete the account; it stays restorable for 30 days."),
    }, "Offboard a user and reclaim what they were consuming.", new[]
    {
        "Needs the User Administrator GDAP role.",
        "restore-user reverses the deletion within 30 days, but licences are not restored with it.",
        "Licences that came from group membership are reclaimed by removing the user from the group.",
    });

    [McpServerTool(Name = "pc_plan_order_lifecycle"), Description("The ordered workflow from cart to PROVISIONED subscriptions: build, check out, poll the order, resolve the subscriptions, confirm each provisioned.")]
    public static object PlanOrderLifecycle([Description("customer id (optional)")] string? customerId = null) => BuildPlan(customerId, new[]
    {
        ("create-cart", "Build the cart; it validates and prices the purchase before it is placed."),
        ("checkout-cart", "Place the order. A 2xx here means ACCEPTED, not provisioned."),
        ("get-order-provisioning-status", "Poll until every line item reports success - the step usually skipped."),
        ("get-subscriptions-by-order", "Resolve the subscriptions the order created."),
        ("get-subscription-provisioning-status", "Confirm each one provisioned before treating its licences as assignable."),
    }, "Take a purchase from cart to subscriptions you can prove exist.", new[]
    {
        "Provisioning is reported per ORDER LINE ITEM, so a partially provisioned order is normal.",
        "Software and perpetual purchases cancel at the order (cancel-software-purchase); seat-based ones at the subscription.",
        "Products that need activation expose a link per line item - see get-order-activation-link.",
    });

    /// <summary>
    /// The subscription lifecycle is one tool with nine branches rather than
    /// nine tools: an agent choosing between them is choosing an operation, and
    /// that reads better as an argument than as a tool name.
    /// </summary>
    private static readonly Dictionary<string, (string Goal, (string id, string why)[] Chain, string[] Notes)> SubscriptionChanges = new()
    {
        ["increase-seats"] = (
            "Add seats to an active subscription.",
            new[]
            {
                ("get-subscription-by-id", "Read the current resource; the PATCH sends it back whole."),
                ("change-subscription-quantity", "PATCH the new TOTAL seat count; increases are prorated and need no window."),
                ("get-subscription-provisioning-status", "Confirm the change provisioned."),
            },
            new[]
            {
                "Increases are unconditional; it is decreases that are bounded by cancellationAllowedUntilDate.",
                "quantity is the new total, not a delta.",
                "Omitting autoRenewEnabled from the PATCH silently resets it to false.",
            }),
        ["decrease-seats"] = (
            "Remove seats from an active subscription.",
            new[]
            {
                ("get-subscription-by-id", "Read cancellationAllowedUntilDate; it decides whether this is allowed at all."),
                ("change-subscription-quantity", "PATCH the lower TOTAL seat count."),
                ("get-subscription-provisioning-status", "Confirm the reduction provisioned."),
            },
            new[]
            {
                "GUARD: cancellationAllowedUntilDate must still be in the future. Read it, do not assume a window length.",
                "Past that date the request fails with 800090; schedule the smaller count for the next term instead.",
                "Seat reduction is not supported at all while suspended.",
            }),
        ["upgrade"] = (
            "Move a subscription to a different offer (New Commerce transition).",
            new[]
            {
                ("get-subscription-transition-eligibilities", "GUARD: the target must appear here; take its catalogItemId."),
                ("create-subscription-transition", "Perform the transition; transitionType decides whether licences move too."),
                ("get-subscription-transitions", "Poll the history - a transition is asynchronous."),
            },
            new[]
            {
                "An empty eligibility list means there is no path from this offer.",
                "eligibilityType=immediate transitions now; scheduled targets the next term.",
                "Legacy subscriptions upgrade through the /upgrades route instead.",
            }),
        ["cancel"] = (
            "Cancel a subscription and stop billing it.",
            new[]
            {
                ("get-subscription-by-id", "Read cancellationAllowedUntilDate and refundOptions."),
                ("cancel-subscription", "PATCH the full resource with status \"deleted\"."),
                ("get-subscription-provisioning-status", "Confirm the cancellation provisioned."),
            },
            new[]
            {
                "GUARD: cancellationAllowedUntilDate must still be in the future, and refundOptions says what comes back.",
                "Past it the request fails with 900117 / 900213; the only lever left is turning autorenew off.",
                "Suspending is not cancelling - it stops service without stopping billing.",
                "Software and perpetual purchases cancel at the ORDER instead.",
            }),
        ["renew-change"] = (
            "Change what the subscription renews into at the next term.",
            new[]
            {
                ("get-subscription-by-id", "autoRenewEnabled must be true or the instructions never run."),
                ("get-subscription-transition-eligibilities", "For end-of-sale-with-conversions offers, get the scheduled target."),
                ("create-scheduled-changes", "PATCH the resource carrying scheduledActions or scheduledNextTermInstructions."),
            },
            new[]
            {
                "GUARD: autoRenewEnabled must be true.",
                "Term, billing cycle and seat count cannot change mid-term; this is how they change at the next one.",
                "Send scheduledActions OR scheduledNextTermInstructions, never both.",
            }),
        ["suspend"] = (
            "Suspend a subscription's service.",
            new[]
            {
                ("get-subscription-by-id", "Read the resource; the PATCH sends it back whole."),
                ("suspend-subscription", "PATCH the full resource with status \"suspended\"."),
            },
            new[]
            {
                "Suspension stops service but NOT billing. To stop paying, cancel inside the window.",
                "Seat count cannot be changed while suspended.",
            }),
        ["reactivate"] = (
            "Bring a suspended subscription back into service.",
            new[]
            {
                ("get-subscription-by-id", "Read suspensionReasons before trying."),
                ("reactivate-subscription", "PATCH the full resource with status \"active\"."),
            },
            new[]
            {
                "GUARD: a subscription Microsoft suspended stays suspended until that reason clears.",
                "Only valid from suspended - a cancelled subscription has to be repurchased.",
            }),
        ["migrate"] = (
            "Migrate a legacy subscription to New Commerce.",
            new[]
            {
                ("validate-migration", "GUARD: returns isEligible plus the exact reasons it would be rejected."),
                ("migrate-to-new-commerce", "Start the migration; omitted properties carry legacy values forward."),
                ("get-migration", "Poll it - migration is asynchronous."),
                ("get-migration-events", "The step-by-step trail, and the only place a failure reason survives."),
            },
            new[]
            {
                "Base subscriptions migrate with all active add-ons as a bundle; one ineligible add-on fails the lot.",
                "To run it later use create-migration-schedule, which can fire at the legacy renewal.",
            }),
        ["transfer"] = (
            "Move billing ownership of a customer's subscriptions to another partner.",
            new[]
            {
                ("create-transfer", "The TARGET partner creates it; transferType 3 for New Commerce."),
                ("get-transfer", "Poll status - the source partner accepts or rejects on their side."),
                ("list-customer-subscriptions", "Verify the subscriptions now sit under the new partner."),
            },
            new[]
            {
                "GUARD: the customer must already have a reseller relationship with the target partner, or creation fails with 900400.",
                "The source partner responds with accept-transfer or reject-transfer.",
                "A pending transfer blocks other lifecycle writes on the affected subscriptions.",
            }),
    };

    [McpServerTool(Name = "pc_plan_subscription_change"), Description(
        "The ordered call sequence for one subscription lifecycle change: increase-seats, decrease-seats, upgrade, cancel, renew-change, suspend, reactivate, migrate or transfer. Each plan reads the subscription first, states the precondition that decides whether the change is legal, performs it, and confirms it. Use pc_explain_lifecycle to find out WHICH operation is available.")]
    public static object PlanSubscriptionChange(
        [Description("increase-seats|decrease-seats|upgrade|cancel|renew-change|suspend|reactivate|migrate|transfer")] string operation,
        [Description("customer id (optional)")] string? customerId = null)
    {
        if (!SubscriptionChanges.TryGetValue(operation, out var plan))
            return new { error = $"Unknown operation \"{operation}\".", known = SubscriptionChanges.Keys };
        return BuildPlan(customerId, plan.Chain, plan.Goal, plan.Notes);
    }
}

[McpServerToolType]
public static class SearchTools
{
    [McpServerTool(Name = "pc_diagnose"), Description("Map a symptom or keyword to likely error codes and relevant scenarios.")]
    public static object Diagnose([Description("symptom or keyword")] string symptom)
    {
        var q = symptom.ToLowerInvariant();
        var terms = Regex.Split(q, @"\W+").Where(t => t.Length > 2).ToArray();
        bool Hit(string text) => terms.Any(t => text.ToLowerInvariant().Contains(t));
        var errors = Knowledge.Current.Errors
            .Where(e => Hit(e.Description) || e.Causes.Any(Hit) || e.ErrorCode.Contains(q))
            .Select(e => new { e.HttpStatus, e.ErrorCode, e.Description, e.Remediation, e.DocUrl }).Take(5);
        var scenarios = Knowledge.Current.Scenarios
            .Where(s => Hit(s.Title) || s.Gotchas.Any(Hit))
            .Select(s => new { s.Id, s.Title, s.Method, s.Path, s.DocUrl }).Take(5);
        return new { symptom, errors, scenarios };
    }

    [McpServerTool(Name = "pc_search_docs"), Description("Search the curated knowledge pack (scenarios + errors) by keyword and return matches with docUrls.")]
    public static object SearchDocs([Description("search query")] string query)
    {
        var terms = Regex.Split(query.ToLowerInvariant(), @"\W+").Where(t => t.Length > 2).ToArray();
        bool Hit(string text) { var l = text.ToLowerInvariant(); return terms.Length == 0 || terms.Any(t => l.Contains(t)); }
        var scenarios = Knowledge.Current.Scenarios
            .Where(s => Hit(s.Title + " " + s.Area + " " + s.Path + " " + string.Join(" ", s.Gotchas)))
            .Select(s => new { type = "scenario", s.Id, s.Title, s.DocUrl }).Take(8);
        var errors = Knowledge.Current.Errors
            .Where(e => Hit(e.ErrorCode + " " + e.Description + " " + e.Remediation))
            .Select(e => new { type = "error", id = e.ErrorCode, title = e.Description, e.DocUrl }).Take(8);
        return new { query, results = scenarios.Cast<object>().Concat(errors).ToList() };
    }
}
