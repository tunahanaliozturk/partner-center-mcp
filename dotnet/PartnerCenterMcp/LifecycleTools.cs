using System.ComponentModel;
using System.Text.RegularExpressions;
using ModelContextProtocol.Server;

namespace PartnerCenterMcp;

[McpServerToolType]
public static class LifecycleTools
{
    [McpServerTool(Name = "pc_explain_lifecycle"), Description(
        "The subscription lifecycle state machine: which operations (increase-seats, decrease-seats, upgrade, cancel, renew-change, suspend, reactivate, migrate, transfer) are legal from which state, the field to read off the live subscription before attempting each one, the scenario that performs it, and the errors a failed precondition returns. Omit operation for the whole machine.")]
    public static object ExplainLifecycle([Description("one operation, or omit for all")] string? operation = null)
    {
        var lifecycle = Knowledge.Current.Lifecycle;
        if (operation is null) return new { lifecycle.States, lifecycle.Operations };

        var match = lifecycle.Operations.Where(o => o.Operation == operation).ToList();
        return match.Count > 0
            ? new { lifecycle.States, Operations = match }
            : (object)new
            {
                error = $"Unknown lifecycle operation \"{operation}\".",
                known = lifecycle.Operations.Select(o => o.Operation),
            };
    }

    [McpServerTool(Name = "pc_diff_pack"), Description(
        "What changed between releases of this knowledge pack, newest first: scenarios added, removed, or whose route, auth, headers, fields, response shape or documented constraints moved. Re-verifying a scenario is not a change. For Microsoft's own deprecation deadlines use pc_whats_new.")]
    public static object DiffPack(
        [Description("only releases after this pack version, e.g. 0.17.0 (optional)")] string? since = null,
        [Description("only releases touching this scenario id (optional)")] string? id = null)
    {
        var all = Knowledge.Current.History;
        if (since is not null && !all.Any(r => r.Version == since))
            return new { error = $"No recorded release \"{since}\".", recorded = all.Select(r => r.Version) };

        // Stored newest first, so everything before the named version came after it.
        var cut = since is null ? all.Count : all.FindIndex(r => r.Version == since);
        var releases = all.Take(cut).ToList();

        if (id is not null)
        {
            List<string> Only(List<string> ids) => ids.Where(x => x == id).ToList();
            releases = releases
                .Select(r => r with { Added = Only(r.Added), Changed = Only(r.Changed), Removed = Only(r.Removed) })
                .Where(r => r.Added.Count + r.Changed.Count + r.Removed.Count > 0)
                .ToList();
        }

        object Expand(List<string> ids) => ids.Select(x =>
        {
            var s = Knowledge.Current.Scenario(x);
            // A removed scenario is no longer in the pack, so only its id survives.
            return s is null
                ? new { id = x, title = "", method = "", path = "", docUrl = "" }
                : new { id = x, title = s.Title, method = s.Method, path = s.Path, docUrl = s.DocUrl };
        }).ToList();

        var notes = new List<string>
        {
            "A scenario counts as changed when its method, path, api, auth type, headers, request fields, request or response shape, gotchas, or doc link differ. Re-verification alone is not a change.",
            "Release versions are this pack's, not Microsoft's.",
        };
        if (releases.Count == 0)
            notes.Add(id is not null ? $"No recorded release touched \"{id}\"." : "Nothing recorded for that range.");

        return new
        {
            releases = releases.Select(r => new
            {
                r.Version, r.Date, r.ScenarioCount,
                Added = Expand(r.Added), Changed = Expand(r.Changed), Removed = Expand(r.Removed),
            }),
            notes,
        };
    }

    /// <summary>
    /// Placeholders a caller decides rather than looks up: paging, filtering,
    /// market and segment. Keeping them out of "unresolved" leaves that list
    /// meaning only "an id the map genuinely fails to explain".
    /// </summary>
    private static readonly HashSet<string> CallerSupplied = new(StringComparer.Ordinal)
    {
        "size", "offset", "filter", "url-encoded-json", "country", "country-code", "currency",
        "currency-code", "region", "segment", "targetSegment", "targetView", "start", "end",
        "start-time", "end-time", "language", "market", "month", "date", "period", "term-duration",
        "term-start-date", "billing-cycle-type", "billing-period", "agreement-type", "validation-type",
        "program-name", "tenant-id", "domain", "isocode-id", "granularity", "view", "base-sku-paths",
        "external-reference-id", "groupby-queries", "filter-string", "mpnId", "MpnId", "TenantId",
        "daily|hourly", "true|false", "immediate|scheduled", "current|previous", "Active|Resolved|Investigating",
        "target-segment", "target-view", "startDate", "endDate", "billing-provider",
        "invoice-line-item-type", "resourceType", "relationship-type", "group-id",
    };

    private static List<string> PlaceholdersOf(string path) =>
        Regex.Matches(path, @"\{([^}]+)\}").Select(m => m.Groups[1].Value).ToList();

    private static PrerequisiteProducer? ProducerFor(string placeholder, string targetPath)
    {
        var candidates = Knowledge.Current.Prerequisites.Where(p => p.Placeholder == placeholder).ToList();
        // A qualified entry wins when its condition matches, otherwise the plain
        // one. policy-id means two different things depending on the route.
        return candidates.FirstOrDefault(p => p.WhenPathContains is not null && targetPath.Contains(p.WhenPathContains))
            ?? candidates.FirstOrDefault(p => p.WhenPathContains is null);
    }

    [McpServerTool(Name = "pc_plan_prerequisites"), Description(
        "For any scenario, the ordered calls that produce the ids its path needs, plus the parameters you supply yourself. Answers \"I want to call this, what do I need first\" for every operation in the pack. For a business sequence and its preconditions prefer the curated pc_plan_* workflows.")]
    public static object PlanPrerequisites(
        [Description("scenario id you want to end up calling")] string id,
        [Description("customer tenant id, substituted into every step (optional)")] string? customerId = null)
    {
        var target = Knowledge.Current.Scenario(id);
        if (target is null)
            return new { error = $"No scenario with id \"{id}\".", ids = Knowledge.Current.Scenarios.Select(s => s.Id) };

        var steps = new List<(string ScenarioId, string Provides, string Why)>();
        var callerSupplied = new List<string>();
        var unresolved = new List<string>();
        var emitted = new HashSet<string>();
        var visiting = new HashSet<string>();

        void Resolve(string path)
        {
            foreach (var placeholder in PlaceholdersOf(path))
            {
                if (CallerSupplied.Contains(placeholder))
                {
                    if (!callerSupplied.Contains(placeholder)) callerSupplied.Add(placeholder);
                    continue;
                }
                var producer = ProducerFor(placeholder, path);
                if (producer is null)
                {
                    if (!unresolved.Contains(placeholder)) unresolved.Add(placeholder);
                    continue;
                }
                if (visiting.Contains(producer.ProducedBy) || producer.ProducedBy == target.Id)
                {
                    if (!callerSupplied.Contains(placeholder)) callerSupplied.Add(placeholder);
                    continue;
                }
                if (emitted.Contains(producer.ProducedBy)) continue;

                var scenario = Knowledge.Current.Scenario(producer.ProducedBy);
                if (scenario is null)
                {
                    if (!unresolved.Contains(placeholder)) unresolved.Add(placeholder);
                    continue;
                }
                // A producer that asks for the very id it yields cannot start the
                // chain: emitting it would name a call you cannot make.
                if (PlaceholdersOf(scenario.Path).Contains(placeholder))
                {
                    if (!callerSupplied.Contains(placeholder)) callerSupplied.Add(placeholder);
                    continue;
                }

                visiting.Add(producer.ProducedBy);
                Resolve(scenario.Path);
                visiting.Remove(producer.ProducedBy);

                if (emitted.Contains(producer.ProducedBy)) continue;
                emitted.Add(producer.ProducedBy);
                steps.Add((scenario.Id, placeholder, producer.Note));
            }
        }

        Resolve(target.Path);

        string Fill(string p) => customerId is null ? p : p.Replace("{customer-id}", customerId);
        var visible = steps
            .Where(s => !(customerId is not null && s.Provides == "customer-id"))
            .Select((s, i) =>
            {
                var scenario = Knowledge.Current.Scenario(s.ScenarioId)!;
                return new
                {
                    order = i + 1,
                    scenarioId = s.ScenarioId,
                    scenario.Title,
                    scenario.Method,
                    path = Fill(scenario.Path),
                    provides = s.Provides,
                    why = s.Why,
                };
            })
            .ToList();

        var notes = new List<string>
        {
            "Parameter resolution only: this says how to obtain the ids, not whether the operation is allowed. Check preconditions with pc_explain_lifecycle for subscription changes.",
            "Each step's response carries the id the next one needs.",
        };
        if (unresolved.Count > 0)
            notes.Add($"No producer is mapped for: {string.Join(", ", unresolved)}.");

        return new
        {
            target = new { scenarioId = target.Id, target.Title, target.Method, path = Fill(target.Path) },
            steps = visible,
            callerSupplied,
            unresolved,
            notes,
        };
    }
}
