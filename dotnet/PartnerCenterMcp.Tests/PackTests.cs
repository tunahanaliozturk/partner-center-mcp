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
}
