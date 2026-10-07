package provider

import (
	"context"

	"github.com/amirhosseintowfighi/gereh/integrations/terraform-provider-gereh/internal/client"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

type serverDataSource struct{ c *client.Client }

type serverModel struct {
	ID       types.String `tfsdk:"id"`
	Name     types.String `tfsdk:"name"`
	Status   types.String `tfsdk:"status"`
	Plan     types.String `tfsdk:"plan"`
	CPU      types.Int64  `tfsdk:"cpu"`
	RAMGB    types.Int64  `tfsdk:"ram_gb"`
	DiskGB   types.Int64  `tfsdk:"disk_gb"`
	Location types.String `tfsdk:"location"`
	OS       types.String `tfsdk:"os"`
	IPv4     types.String `tfsdk:"ipv4"`
	IPv6     types.String `tfsdk:"ipv6"`
	Hostname types.String `tfsdk:"hostname"`
}

func NewServerDataSource() datasource.DataSource { return &serverDataSource{} }

func (d *serverDataSource) Metadata(_ context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_server"
}

func (d *serverDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	computed := func(desc string) schema.StringAttribute { return schema.StringAttribute{Computed: true, Description: desc} }
	resp.Schema = schema.Schema{
		Description: "Look up a cloud server, e.g. to point DNS records at its IP.",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{Required: true, Description: "Server id, e.g. srv-1042."},
			"name": computed(""), "status": computed("building, running, stopped or suspended"), "plan": computed(""),
			"cpu": schema.Int64Attribute{Computed: true}, "ram_gb": schema.Int64Attribute{Computed: true}, "disk_gb": schema.Int64Attribute{Computed: true},
			"location": computed("thr, isf, fra or ams"), "os": computed(""), "ipv4": computed(""), "ipv6": computed(""), "hostname": computed(""),
		},
	}
}

func (d *serverDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, _ *datasource.ConfigureResponse) {
	if c, ok := req.ProviderData.(*client.Client); ok {
		d.c = c
	}
}

func (d *serverDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var m serverModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &m)...)
	if resp.Diagnostics.HasError() {
		return
	}
	s, err := d.c.GetServer(ctx, m.ID.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Reading server failed", err.Error())
		return
	}
	str := func(p *string) types.String {
		if p == nil {
			return types.StringNull()
		}
		return types.StringValue(*p)
	}
	m = serverModel{ID: types.StringValue(s.ID), Name: types.StringValue(s.Name), Status: types.StringValue(s.Status), Plan: types.StringValue(s.Plan),
		CPU: types.Int64Value(s.CPU), RAMGB: types.Int64Value(s.RAMGB), DiskGB: types.Int64Value(s.DiskGB), Location: types.StringValue(s.Location),
		OS: types.StringValue(s.OS), IPv4: str(s.IPv4), IPv6: str(s.IPv6), Hostname: types.StringValue(s.Hostname)}
	resp.Diagnostics.Append(resp.State.Set(ctx, m)...)
}
