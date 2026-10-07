package provider

import (
	"context"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	fwprovider "github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/resource"
)

// The framework validates schemas when they are built; this catches mistakes without a Terraform binary.
func TestSchemasAreValid(t *testing.T) {
	ctx := context.Background()
	p := New("test")()
	var ps fwprovider.SchemaResponse
	p.Schema(ctx, fwprovider.SchemaRequest{}, &ps)
	if ps.Diagnostics.HasError() {
		t.Fatal(ps.Diagnostics)
	}
	for _, f := range p.Resources(ctx) {
		var rs resource.SchemaResponse
		f().Schema(ctx, resource.SchemaRequest{}, &rs)
		if rs.Diagnostics.HasError() || rs.Schema.ValidateImplementation(ctx).HasError() {
			t.Fatalf("resource schema: %v %v", rs.Diagnostics, rs.Schema.ValidateImplementation(ctx))
		}
		var md resource.MetadataResponse
		f().Metadata(ctx, resource.MetadataRequest{ProviderTypeName: "gereh"}, &md)
		if md.TypeName != "gereh_dns_record" {
			t.Fatalf("type name %q", md.TypeName)
		}
	}
	for _, f := range p.DataSources(ctx) {
		var ds datasource.SchemaResponse
		f().Schema(ctx, datasource.SchemaRequest{}, &ds)
		if ds.Diagnostics.HasError() || ds.Schema.ValidateImplementation(ctx).HasError() {
			t.Fatalf("data source schema: %v", ds.Diagnostics)
		}
	}
}
