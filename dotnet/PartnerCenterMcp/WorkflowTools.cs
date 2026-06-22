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
