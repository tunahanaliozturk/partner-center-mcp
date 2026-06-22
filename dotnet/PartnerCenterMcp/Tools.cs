using System.ComponentModel;
using ModelContextProtocol.Server;

namespace PartnerCenterMcp;

[McpServerToolType]
public static class ScenarioTools
{
    [McpServerTool(Name = "pc_list_scenarios"), Description("List supported Partner Center REST scenarios, optionally filtered by area.")]
    public static object ListScenarios([Description("Optional area filter")] string? area = null)
    {
        var s = Knowledge.Current.Scenarios.AsEnumerable();
        if (!string.IsNullOrWhiteSpace(area))
            s = s.Where(x => x.Area.Equals(area, StringComparison.OrdinalIgnoreCase));
        return s.Select(x => new { x.Id, x.Title, x.Area, x.Method, x.Path, x.AuthType, x.DocUrl }).ToList();
    }

    [McpServerTool(Name = "pc_get_scenario"), Description("Full detail for one Partner Center scenario by id: method, path, headers, examples, gotchas.")]
    public static object GetScenario([Description("scenario id")] string id)
    {
        var s = Knowledge.Current.Scenarios.FirstOrDefault(x => x.Id == id);
        return s is not null ? s : new { error = $"No scenario with id \"{id}\".", ids = Knowledge.Current.Scenarios.Select(x => x.Id) };
    }

    [McpServerTool(Name = "pc_lookup_error"), Description("Decode a Partner Center REST error by error code: meaning, causes, remediation, related scenarios.")]
    public static object LookupError([Description("error code, e.g. 900420")] string code)
    {
        var e = Knowledge.Current.Errors.FirstOrDefault(x => x.ErrorCode == code);
        if (e is null) return new { error = $"No error with code \"{code}\".", codes = Knowledge.Current.Errors.Select(x => x.ErrorCode) };
        var related = (e.RelatedScenarios ?? new()).Select(id => Knowledge.Current.Scenarios.FirstOrDefault(s => s.Id == id))
            .Where(s => s is not null).Select(s => new { s!.Id, s.Title, s.DocUrl });
        return new { e.HttpStatus, e.ErrorCode, e.Description, e.Causes, e.Remediation, e.DocUrl, RelatedScenarios = related };
    }
}
