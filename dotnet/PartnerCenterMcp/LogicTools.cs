using System.ComponentModel;
using System.Text.Json;
using System.Text.RegularExpressions;
using ModelContextProtocol.Server;

namespace PartnerCenterMcp;

[McpServerToolType]
public static class CodegenTools
{
    private const string Commercial = "https://api.partnercenter.microsoft.com";

    private static string FullUrl(string path) =>
        path.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? path : Commercial + path;

    private static List<string> NotesFor(Scenario s)
    {
        var notes = new List<string>();
        if ((s.ResponseShape ?? "").Contains("collection", StringComparison.OrdinalIgnoreCase))
            notes.Add("Paginate: follow links.next in each response until it is absent.");
        if (new[] { "POST", "PUT", "PATCH", "DELETE" }.Contains(s.Method))
            notes.Add("Idempotency: send a unique MS-RequestId and reuse it on retries.");
        notes.Add("Throttling: on HTTP 429, honor the Retry-After header and back off.");
        notes.Add("Long-running writes may return HTTP 202 with a Location header — poll it.");
        if (s.AuthType == "app+user") notes.Add("This scenario needs an App+User (secure application model) token.");
        return notes;
    }

    [McpServerTool(Name = "pc_generate_call"), Description("Generate a current Partner Center REST call for a scenario in curl/csharp/typescript/powershell, with per-scenario notes. Never emits the archived .NET SDK.")]
    public static object GenerateCall(
        [Description("scenario id")] string id,
        [Description("curl|csharp|typescript|powershell")] string language)
    {
        var s = Knowledge.Current.Scenarios.FirstOrDefault(x => x.Id == id);
        if (s is null) return new { error = $"No scenario with id \"{id}\".", ids = Knowledge.Current.Scenarios.Select(x => x.Id) };
        string code = language switch
        {
            "curl" => s.Examples.Curl,
            "csharp" => s.Examples.Csharp,
            "typescript" => s.Examples.Typescript,
            "powershell" => $"# PowerShell (Invoke-RestMethod)\nInvoke-RestMethod -Method {s.Method} -Uri \"{FullUrl(s.Path)}\" -Headers @{{ Authorization = \"Bearer $token\" }}",
            _ => s.Examples.Curl,
        };
        return new { language, code, notes = NotesFor(s), s.AuthType, s.Method, s.Path, s.DocUrl };
    }

    [McpServerTool(Name = "pc_build_request"), Description("Build a ready-to-send request for a scenario: substitutes path placeholders from params, fills headers (Bearer + generated MS-RequestId on writes), and produces a body skeleton from the scenario's required fields.")]
    public static object BuildRequest(
        [Description("scenario id")] string id,
        [Description("path placeholder values, e.g. { \"customer-id\": \"...\" }")] Dictionary<string, string>? @params = null)
    {
        var s = Knowledge.Current.Scenarios.FirstOrDefault(x => x.Id == id);
        if (s is null) return new { error = $"No scenario with id \"{id}\".", ids = Knowledge.Current.Scenarios.Select(x => x.Id) };
        var p = @params ?? new();
        string Norm(string x) => Regex.Replace(x.ToLowerInvariant(), "[^a-z0-9]", "");
        var byNorm = p.ToDictionary(kv => Norm(kv.Key), kv => kv.Value);

        var missing = new List<string>();
        var filled = Regex.Replace(s.Path, @"\{([^}]+)\}", m =>
        {
            var tok = m.Groups[1].Value;
            if (p.TryGetValue(tok, out var v) || byNorm.TryGetValue(Norm(tok), out v)) return Uri.EscapeDataString(v);
            missing.Add(tok); return m.Value;
        });
        var url = FullUrl(filled);
        var isWrite = new[] { "POST", "PUT", "PATCH", "DELETE" }.Contains(s.Method);
        var isGraph = url.StartsWith("https://graph.microsoft.com");

        var headers = new Dictionary<string, string>();
        foreach (var h in s.Headers)
        {
            var n = h.Name.ToLowerInvariant();
            headers[h.Name] = n switch
            {
                "authorization" => isGraph ? "Bearer <graph-access-token>" : "Bearer <access-token>",
                "content-type" => "application/json",
                "accept" => "application/json",
                "ms-requestid" or "ms-correlationid" => Guid.NewGuid().ToString(),
                _ => $"<{h.Name}>",
            };
        }
        if (isWrite && !headers.Keys.Any(k => k.Equals("ms-requestid", StringComparison.OrdinalIgnoreCase)))
            headers["MS-RequestId"] = Guid.NewGuid().ToString();

        Dictionary<string, object?>? body = null;
        if (s.RequestFields is { Count: > 0 })
        {
            body = new();
            foreach (var f in s.RequestFields)
            {
                if (f.Name.StartsWith("(")) continue;
                SetField(body, f.Name, DefaultFor(f.Type, f.Note));
            }
            if (body.Count == 0) body = null;
        }

        return new
        {
            scenarioId = s.Id, s.Method, url, headers, body,
            missingParams = missing, s.AuthType, s.DocUrl,
            note = missing.Count > 0 ? $"Provide params for: {string.Join(", ", missing)}" : "All path placeholders filled.",
        };
    }

    private static object? DefaultFor(string type, string? note)
    {
        var lit = note is null ? null : Regex.Match(note, "'([^']+)'");
        if (lit is { Success: true }) return lit.Groups[1].Value;
        var t = type.ToLowerInvariant();
        if (t.Contains("bool")) return false;
        if (t.Contains("int") || t.Contains("number") || t.Contains("decimal")) return 0;
        if (t.EndsWith("[]") || t.Contains("array")) return new List<object?>();
        if (t.Contains("object") || (type.Length > 0 && char.IsUpper(type[0]))) return new Dictionary<string, object?>();
        return "";
    }

    private static void SetField(Dictionary<string, object?> root, string name, object? value)
    {
        var parts = name.Split('.');
        var cur = root;
        for (int i = 0; i < parts.Length; i++)
        {
            var raw = parts[i];
            var isLast = i == parts.Length - 1;
            var isArr = raw.EndsWith("[]");
            var key = isArr ? raw[..^2] : raw;
            if (isArr)
            {
                if (cur.GetValueOrDefault(key) is not List<object?> arr || arr.Count == 0)
                {
                    arr = new List<object?> { new Dictionary<string, object?>() };
                    cur[key] = arr;
                }
                if (isLast) return;
                cur = (Dictionary<string, object?>)arr[0]!;
            }
            else if (isLast) cur[key] = value;
            else
            {
                if (cur.GetValueOrDefault(key) is not Dictionary<string, object?> next) { next = new(); cur[key] = next; }
                cur = next;
            }
        }
    }

    [McpServerTool(Name = "pc_migrate_from_sdk"), Description("Translate archived Partner Center .NET SDK code into the equivalent current REST scenario(s).")]
    public static object MigrateFromSdk([Description("archived SDK code snippet")] string code)
    {
        var matches = new List<object>();
        foreach (var m in Knowledge.Current.SdkMap)
        {
            var parts = m.SdkPattern.Split('.');
            var tail = string.Join(".", parts.Skip(Math.Max(0, parts.Length - 2)));
            var needle = Regex.Replace(tail, @"\{[^}]+\}", "");
            needle = Regex.Replace(needle, @"\(\)$", "");
            needle = needle.Replace("(", "").Replace(")", "");
            var pattern = needle.Replace(".", "\\.");
            if (pattern.Length == 0 || !Regex.IsMatch(code, pattern, RegexOptions.IgnoreCase)) continue;
            var sc = Knowledge.Current.Scenarios.FirstOrDefault(x => x.Id == m.RestScenarioId);
            if (sc is not null) matches.Add(new { m.SdkPattern, m.Notes, scenario = new { sc.Id, sc.Title, sc.Method, sc.Path, sc.DocUrl } });
        }
        return new { matches, unmatched = matches.Count == 0 };
    }
}
