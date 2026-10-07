// Package provider implements the Gereh Terraform provider.
package provider

import (
	"context"
	"os"

	"github.com/amirhosseintowfighi/gereh/integrations/terraform-provider-gereh/internal/client"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

type gerehProvider struct{ version string }

type providerModel struct {
	Endpoint types.String `tfsdk:"endpoint"`
	Token    types.String `tfsdk:"token"`
}

func New(version string) func() provider.Provider {
	return func() provider.Provider { return &gerehProvider{version: version} }
}

func (p *gerehProvider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "gereh"
	resp.Version = p.version
}

func (p *gerehProvider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manage Gereh Cloud resources. Create an API token in Panel › SSH و API.",
		Attributes: map[string]schema.Attribute{
			"endpoint": schema.StringAttribute{Optional: true, Description: "Base URL (default https://gereh.cloud or GEREH_ENDPOINT)."},
			"token":    schema.StringAttribute{Optional: true, Sensitive: true, Description: "API token (or GEREH_TOKEN)."},
		},
	}
}

func (p *gerehProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	var cfg providerModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &cfg)...)
	if resp.Diagnostics.HasError() {
		return
	}
	endpoint := firstNonEmpty(cfg.Endpoint.ValueString(), os.Getenv("GEREH_ENDPOINT"), "https://gereh.cloud")
	token := firstNonEmpty(cfg.Token.ValueString(), os.Getenv("GEREH_TOKEN"))
	if token == "" {
		resp.Diagnostics.AddError("Missing API token", "Set the provider's token attribute or the GEREH_TOKEN environment variable.")
		return
	}
	c := client.New(endpoint, token)
	resp.DataSourceData = c
	resp.ResourceData = c
}

func (p *gerehProvider) Resources(context.Context) []func() resource.Resource {
	return []func() resource.Resource{NewDNSRecordResource}
}

func (p *gerehProvider) DataSources(context.Context) []func() datasource.DataSource {
	return []func() datasource.DataSource{NewServerDataSource}
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}
