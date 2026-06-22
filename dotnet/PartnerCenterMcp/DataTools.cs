using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;

namespace PartnerCenterMcp;

[McpServerToolType]
public static class DataTools
{
    [McpServerTool(Name = "pc_get_enums"), Description("Look up Partner Center enum values (billingCycle, termDuration, targetView, segment, transitionType, subscriptionStatus, qualification, agreementType, billingType, provisioningStatus). Omit name to list all.")]
    public static object GetEnums([Description("enum name (optional)")] string? name = null)
    {
        var enums = Knowledge.Current.Enums;
        if (string.IsNullOrWhiteSpace(name))
            return enums.EnumerateObject().Select(p => new
            {
                name = p.Name,
                description = p.Value.GetProperty("description").GetString(),
                count = p.Value.GetProperty("values").GetArrayLength(),
            }).ToList();
        foreach (var p in enums.EnumerateObject())
            if (p.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) return p.Value;
        return new { error = $"No enum named \"{name}\".", names = enums.EnumerateObject().Select(p => p.Name) };
    }

    [McpServerTool(Name = "pc_whats_new"), Description("Partner Center API deprecations and deadlines (MFA enforcement, graph.windows.net retirement, DAP->GDAP, v1->v2 reconciliation, SDK/ADAL retirements) with dates and the action to take.")]
    public static object WhatsNew([Description("filter by status: upcoming|in-progress|enforced|retired")] string? status = null)
    {
        var items = Knowledge.Current.Deprecations.AsEnumerable();
        if (!string.IsNullOrWhiteSpace(status))
            items = items.Where(d => d.Status.Equals(status, StringComparison.OrdinalIgnoreCase));
        var sorted = items.OrderByDescending(d => d.Date).ToList();
        return new { count = sorted.Count, items = sorted };
    }

    [McpServerTool(Name = "pc_get_resource"), Description("Field dictionary for Partner Center resources (Customer, Subscription, Order, Invoice, CartLineItem). Omit name to list all.")]
    public static object GetResource([Description("resource name (optional)")] string? name = null)
    {
        var res = Knowledge.Current.Resources;
        if (string.IsNullOrWhiteSpace(name))
            return res.EnumerateObject().Select(p => new
            {
                name = p.Name,
                description = p.Value.GetProperty("description").GetString(),
                fields = p.Value.GetProperty("fields").GetArrayLength(),
            }).ToList();
        foreach (var p in res.EnumerateObject())
            if (p.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) return p.Value;
        return new { error = $"No resource named \"{name}\".", names = res.EnumerateObject().Select(p => p.Name) };
    }

    [McpServerTool(Name = "pc_get_reference"), Description("Partner Center REST reference: base-urls, headers, versioning, sandbox, rate-limits, national-clouds.")]
    public static object GetReference([Description("base-urls|headers|versioning|sandbox|rate-limits|national-clouds")] string topic)
    {
        var r = Knowledge.Current.Reference;
        return topic switch
        {
            "base-urls" => r.GetProperty("baseUrls"),
            "headers" => r.GetProperty("headers"),
            "versioning" => new { versioning = r.GetProperty("versioning").GetString() },
            "sandbox" => new { sandbox = r.GetProperty("sandbox").GetString() },
            "rate-limits" => new { rateLimits = r.GetProperty("rateLimits").GetString() },
            "national-clouds" => new { nationalClouds = r.GetProperty("nationalClouds").GetString() },
            _ => new { error = $"Unknown topic \"{topic}\"." },
        };
    }

    [McpServerTool(Name = "pc_auth_guidance"), Description("Current Partner Center authentication guidance for app-only or app+user, per national cloud, with deprecation and MFA notes.")]
    public static object AuthGuidance(
        [Description("app-only or app+user")] string authType,
        [Description("commercial|china-21vianet|us-gov (default commercial)")] string? cloud = null)
    {
        var a = Knowledge.Current.Auth;
        var cloudKey = string.IsNullOrWhiteSpace(cloud) ? "commercial" : cloud;
        object? cloudVal = a.GetProperty("clouds").TryGetProperty(cloudKey, out var cv) ? cv : null;
        object? pattern = a.GetProperty("patterns").TryGetProperty(authType, out var pv) ? pv : null;
        return new { cloud = cloudVal, pattern, deprecations = a.GetProperty("deprecations") };
    }
}
