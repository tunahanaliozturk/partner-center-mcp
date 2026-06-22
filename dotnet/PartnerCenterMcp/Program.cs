using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using PartnerCenterMcp;

// Load the embedded knowledge pack once at startup.
Knowledge.Load();

var builder = Host.CreateApplicationBuilder(args);

// MCP stdio servers must keep stdout clean for the protocol — route logs to stderr.
builder.Logging.AddConsole(o => o.LogToStandardErrorThreshold = LogLevel.Trace);

builder.Services
    .AddMcpServer()
    .WithStdioServerTransport()
    .WithToolsFromAssembly();

await builder.Build().RunAsync();
