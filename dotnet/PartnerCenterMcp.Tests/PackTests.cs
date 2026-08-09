using System.Text.Json;
using PartnerCenterMcp;
using Xunit;

namespace PartnerCenterMcp.Tests;

public class PackTests
{
    static PackTests() => Knowledge.Load();

    private static string J(object o) => JsonSerializer.Serialize(o);

    [Fact]
    public void KnowledgePackLoads()
    {
        Assert.True(Knowledge.Current.Scenarios.Count > 0);
        Assert.Contains(Knowledge.Current.Errors, e => e.ErrorCode == "900420");
        Assert.True(Knowledge.Current.Deprecations.Count > 0);
    }

    [Fact]
    public void ListScenariosFiltersByArea()
    {
        var all = J(ScenarioTools.ListScenarios());
        Assert.Contains("verify-mpn", all);
        var invoicing = J(ScenarioTools.ListScenarios("invoicing"));
        Assert.Contains("get-invoices", invoicing);
        Assert.DoesNotContain("verify-mpn", invoicing);
    }

    [Fact]
    public void LookupErrorDecodesAndLinksScenarios()
    {
        var r = J(ScenarioTools.LookupError("13605"));
        Assert.Contains("create-agreement", r); // related scenario resolved
    }

    [Fact]
    public void GetEnumsResolvesValues()
    {
        Assert.Contains("monthly", J(DataTools.GetEnums("billingCycle")));
    }

    [Fact]
    public void BuildRequestFillsPathHeadersAndBody()
    {
        var r = J(CodegenTools.BuildRequest("create-cart", new() { ["customer-id"] = "abc" }));
        Assert.Contains("v1/customers/abc/carts", r);
        Assert.Contains("MS-RequestId", r);
        Assert.Contains("lineItems", r);
    }

    [Fact]
    public void MigrateFromSdkMapsKnownPattern()
    {
        var r = J(CodegenTools.MigrateFromSdk("partner.Customers.ById(id).Subscriptions.Get()"));
        Assert.Contains("list-customer-subscriptions", r);
    }

    [Fact]
    public void CheckAuthFlagsRetiredAudience()
    {
        var r = J(AuthLintTools.CheckAuth("token = get(\"https://graph.windows.net\")"));
        Assert.Contains("900420", r);
    }

    [Fact]
    public void PlanPurchaseReturnsOrderedChain()
    {
        var r = J(WorkflowTools.PlanPurchase("abc"));
        Assert.Contains("get-products", r);
        Assert.Contains("checkout-cart", r);
    }

    // --- parity with the TypeScript server ---------------------------------

    /// <summary>
    /// Both servers ship the same knowledge pack, so they must expose the same
    /// tools. This package fell eight tools behind once already; the list is
    /// read out of the assembly rather than written down twice.
    /// </summary>
    [Fact]
    public void ExposesEveryToolTheTypeScriptServerDoes()
    {
        var expected = new[]
        {
            "pc_auth_guidance", "pc_build_request", "pc_check_auth", "pc_decode_error",
            "pc_diagnose", "pc_diff_pack", "pc_explain_lifecycle", "pc_generate_call",
            "pc_get_enums", "pc_get_reference", "pc_get_resource", "pc_get_scenario",
            "pc_list_scenarios", "pc_lookup_error", "pc_migrate_from_sdk",
            "pc_plan_csp_onboarding", "pc_plan_gdap_onboarding", "pc_plan_order_lifecycle",
            "pc_plan_prerequisites", "pc_plan_purchase", "pc_plan_reconciliation",
            "pc_plan_subscription_change", "pc_plan_transfer", "pc_plan_user_offboarding",
            "pc_plan_user_onboarding", "pc_search_docs", "pc_validate_request", "pc_whats_new",
        };

        var actual = typeof(ScenarioTools).Assembly.GetTypes()
            .SelectMany(t => t.GetMethods())
            .SelectMany(m => m.GetCustomAttributes(typeof(ModelContextProtocol.Server.McpServerToolAttribute), false))
            .Cast<ModelContextProtocol.Server.McpServerToolAttribute>()
            .Select(a => a.Name!)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(expected, actual);
    }

    [Fact]
    public void LoadsEveryDataFileInThePack()
    {
        Assert.True(Knowledge.Current.Lifecycle.Operations.Count == 9);
        Assert.True(Knowledge.Current.Examples.Count > 190);
        Assert.True(Knowledge.Current.Prerequisites.Count > 20);
        Assert.True(Knowledge.Current.History.Count > 0);
    }

    [Fact]
    public void ExplainLifecycleNarrowsAndGuards()
    {
        var all = J(LifecycleTools.ExplainLifecycle());
        Assert.Contains("decrease-seats", all);

        var one = J(LifecycleTools.ExplainLifecycle("decrease-seats"));
        Assert.Contains("cancellationAllowedUntilDate", one);

        Assert.Contains("Unknown lifecycle operation", J(LifecycleTools.ExplainLifecycle("nope")));
    }

    [Fact]
    public void PlanPrerequisitesDerivesTheIdChain()
    {
        var plan = J(LifecycleTools.PlanPrerequisites("cancel-subscription"));
        Assert.Contains("list-customers", plan);
        Assert.Contains("list-customer-subscriptions", plan);

        // A supplied customer id makes its lookup pointless and fills the paths.
        var filled = J(LifecycleTools.PlanPrerequisites("cancel-subscription", "c7f6e4b1-3a2d-4c5e-9f80-1b2c3d4e5f60"));
        Assert.DoesNotContain("{customer-id}", filled);
    }

    [Fact]
    public void PlanPrerequisitesExplainsEveryPlaceholderInThePack()
    {
        foreach (var s in Knowledge.Current.Scenarios)
        {
            var result = LifecycleTools.PlanPrerequisites(s.Id);
            var unresolved = (List<string>)result.GetType().GetProperty("unresolved")!.GetValue(result)!;
            Assert.True(unresolved.Count == 0, $"{s.Id} has unexplained placeholders: {string.Join(", ", unresolved)}");
        }
    }

    [Fact]
    public void PlanSubscriptionChangeCoversEveryLifecycleOperation()
    {
        foreach (var op in Knowledge.Current.Lifecycle.Operations)
        {
            var plan = J(WorkflowTools.PlanSubscriptionChange(op.Operation));
            Assert.DoesNotContain("Unknown operation", plan);
            Assert.Contains("steps", plan);
        }
        Assert.Contains("Unknown operation", J(WorkflowTools.PlanSubscriptionChange("nope")));
    }

    [Fact]
    public void DiffPackReportsTheLatestReleaseAndNarrowsById()
    {
        var all = J(LifecycleTools.DiffPack());
        Assert.Contains("0.17.0", all);

        var one = J(LifecycleTools.DiffPack(null, "get-price-sheet"));
        Assert.Contains("get-price-sheet", one);
        Assert.DoesNotContain("get-offer-matrix", one);

        Assert.Contains("No recorded release", J(LifecycleTools.DiffPack("9.9.9")));
    }

    [Fact]
    public void GetScenarioCarriesTheResponseExample()
    {
        var withExample = J(ScenarioTools.GetScenario("get-subscription-by-id"));
        Assert.Contains("exampleResponse", withExample);
    }
}
