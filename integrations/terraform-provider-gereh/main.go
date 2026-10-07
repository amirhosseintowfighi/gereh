// Command terraform-provider-gereh is the Terraform provider for Gereh Cloud.
package main

import (
	"context"
	"flag"
	"log"

	"github.com/amirhosseintowfighi/gereh/integrations/terraform-provider-gereh/internal/provider"
	"github.com/hashicorp/terraform-plugin-framework/providerserver"
)

var version = "dev"

func main() {
	var debug bool
	flag.BoolVar(&debug, "debug", false, "run with support for debuggers like delve")
	flag.Parse()
	err := providerserver.Serve(context.Background(), provider.New(version), providerserver.ServeOpts{
		Address: "registry.terraform.io/gereh/gereh",
		Debug:   debug,
	})
	if err != nil {
		log.Fatal(err)
	}
}
