package provider

import (
	"context"
	"fmt"
	"strings"

	"github.com/amirhosseintowfighi/gereh/integrations/terraform-provider-gereh/internal/client"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/int64default"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

type dnsRecordResource struct{ c *client.Client }

type dnsRecordModel struct {
	ID       types.String `tfsdk:"id"`
	DomainID types.String `tfsdk:"domain_id"`
	Type     types.String `tfsdk:"type"`
	Name     types.String `tfsdk:"name"`
	Value    types.String `tfsdk:"value"`
	TTL      types.Int64  `tfsdk:"ttl"`
	Priority types.Int64  `tfsdk:"priority"`
}

func NewDNSRecordResource() resource.Resource { return &dnsRecordResource{} }

func (r *dnsRecordResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_dns_record"
}

func (r *dnsRecordResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	replace := []planmodifier.String{stringplanmodifier.RequiresReplace()}
	resp.Schema = schema.Schema{
		Description: "A DNS record in a zone hosted on ns1/ns2.gereh.cloud.",
		Attributes: map[string]schema.Attribute{
			"id":        schema.StringAttribute{Computed: true, PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}},
			"domain_id": schema.StringAttribute{Required: true, PlanModifiers: replace, Description: "Domain id, e.g. dom-501."},
			"type":      schema.StringAttribute{Required: true, Description: "A, AAAA, CNAME, MX, TXT, NS, SRV or CAA."},
			"name":      schema.StringAttribute{Required: true, Description: "Record name; @ for the zone apex."},
			"value":     schema.StringAttribute{Required: true},
			"ttl":       schema.Int64Attribute{Optional: true, Computed: true, Default: int64default.StaticInt64(3600)},
			"priority":  schema.Int64Attribute{Optional: true, Description: "MX/SRV priority."},
		},
	}
}

func (r *dnsRecordResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	c, ok := req.ProviderData.(*client.Client)
	if !ok {
		resp.Diagnostics.AddError("Unexpected provider data", fmt.Sprintf("%T", req.ProviderData))
		return
	}
	r.c = c
}

func toAPI(m dnsRecordModel) client.Record {
	rec := client.Record{ID: m.ID.ValueString(), Type: m.Type.ValueString(), Name: m.Name.ValueString(), Value: m.Value.ValueString(), TTL: m.TTL.ValueInt64()}
	if !m.Priority.IsNull() && !m.Priority.IsUnknown() {
		p := m.Priority.ValueInt64()
		rec.Priority = &p
	}
	return rec
}

func fromAPI(m *dnsRecordModel, rec *client.Record) {
	m.ID = types.StringValue(rec.ID)
	m.Type = types.StringValue(rec.Type)
	m.Name = types.StringValue(rec.Name)
	m.Value = types.StringValue(rec.Value)
	m.TTL = types.Int64Value(rec.TTL)
	if rec.Priority != nil {
		m.Priority = types.Int64Value(*rec.Priority)
	} else {
		m.Priority = types.Int64Null()
	}
}

func (r *dnsRecordResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan dnsRecordModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	rec, err := r.c.CreateRecord(ctx, plan.DomainID.ValueString(), toAPI(plan))
	if err != nil {
		resp.Diagnostics.AddError("Creating DNS record failed", err.Error())
		return
	}
	fromAPI(&plan, rec)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *dnsRecordResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state dnsRecordModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	rec, err := r.c.GetRecord(ctx, state.DomainID.ValueString(), state.ID.ValueString())
	if client.IsNotFound(err) {
		resp.State.RemoveResource(ctx)
		return
	}
	if err != nil {
		resp.Diagnostics.AddError("Reading DNS record failed", err.Error())
		return
	}
	fromAPI(&state, rec)
	resp.Diagnostics.Append(resp.State.Set(ctx, state)...)
}

func (r *dnsRecordResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan, state dnsRecordModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	plan.ID = state.ID
	rec, err := r.c.UpdateRecord(ctx, plan.DomainID.ValueString(), toAPI(plan))
	if err != nil {
		resp.Diagnostics.AddError("Updating DNS record failed", err.Error())
		return
	}
	fromAPI(&plan, rec)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *dnsRecordResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state dnsRecordModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	if err := r.c.DeleteRecord(ctx, state.DomainID.ValueString(), state.ID.ValueString()); err != nil && !client.IsNotFound(err) {
		resp.Diagnostics.AddError("Deleting DNS record failed", err.Error())
	}
}

// ImportState accepts "<domain_id>/<record_id>".
func (r *dnsRecordResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	parts := strings.SplitN(req.ID, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		resp.Diagnostics.AddError("Invalid import id", "Use <domain_id>/<record_id>, e.g. dom-501/r-abc123.")
		return
	}
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("domain_id"), parts[0])...)
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("id"), parts[1])...)
}
