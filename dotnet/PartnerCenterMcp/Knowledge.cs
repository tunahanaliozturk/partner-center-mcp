using System.Reflection;
using System.Text.Json;

namespace PartnerCenterMcp;

// Strongly-typed records for the parts we query; raw JsonElement for the rest.
public record Header(string Name, bool Required, string? Note);
public record Field(string Name, string Type, bool Required, string? Note);
public record Examples(string Curl, string Csharp, string Typescript);

public record Scenario(
    string Id, string Area, string Title, string Method, string Path, string AuthType,
    List<Header> Headers, string? RequestShape, List<Field>? RequestFields, string? ResponseShape,
    Examples Examples, List<string> Gotchas, string DocUrl, string LastVerified);

public record ErrorEntry(
    int HttpStatus, string ErrorCode, string Description, List<string> Causes,
    string Remediation, string DocUrl, List<string>? RelatedScenarios);

public record SdkMapping(string SdkPattern, string RestScenarioId, string Notes);

public record DeprecationItem(string Title, string Status, string Date, string Impact, string Action, string? DocUrl);

public sealed class Knowledge
{
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    public required List<Scenario> Scenarios { get; init; }
    public required List<ErrorEntry> Errors { get; init; }
    public required List<SdkMapping> SdkMap { get; init; }
    public required List<DeprecationItem> Deprecations { get; init; }
    public required JsonElement Auth { get; init; }
    public required JsonElement Reference { get; init; }
    public required JsonElement Enums { get; init; }
    public required JsonElement Resources { get; init; }

    public static Knowledge Current { get; private set; } = null!;

    public static Knowledge Load()
    {
        var asm = Assembly.GetExecutingAssembly();
        string Raw(string suffix)
        {
            var name = asm.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException($"Embedded data resource not found: {suffix}");
            using var s = asm.GetManifestResourceStream(name)!;
            using var r = new StreamReader(s);
            return r.ReadToEnd();
        }
        JsonElement Doc(string suffix) => JsonDocument.Parse(Raw(suffix)).RootElement;
        List<T> Arr<T>(string suffix, string prop) =>
            JsonSerializer.Deserialize<List<T>>(Doc(suffix).GetProperty(prop).GetRawText(), Json) ?? new();

        Current = new Knowledge
        {
            Scenarios = Arr<Scenario>("scenarios.json", "scenarios"),
            Errors = Arr<ErrorEntry>("errors.json", "errors"),
            SdkMap = Arr<SdkMapping>("sdk-map.json", "mappings"),
            Deprecations = Arr<DeprecationItem>("deprecations.json", "items"),
            Auth = Doc("auth.json"),
            Reference = Doc("reference.json"),
            Enums = Doc("enums.json").GetProperty("enums"),
            Resources = Doc("resources.json").GetProperty("resources"),
        };
        return Current;
    }
}
