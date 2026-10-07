/** OpenAPI 3.1 description of /api/v1 (served at /api/v1/openapi.json) */
export function openapi(origin: string) {
  const err = { $ref: "#/components/responses/Error" };
  const ok = (schema: object, description = "OK") => ({ description, content: { "application/json": { schema } } });
  const list = (ref: string) => ({ type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/" + ref } } }, required: ["data"] });
  const idParam = (name: string, description: string) => ({ name, in: "path", required: true, schema: { type: "string" }, description });
  return {
    openapi: "3.1.0",
    info: { title: "Gereh Cloud API", version: "1.0.0", description: "Manage Gereh cloud servers, DNS and billing. Create a token in Panel › SSH و API. Read tokens may only use GET. Limit: 120 requests per minute per token. Amounts are in Toman." },
    servers: [{ url: origin + "/api/v1" }],
    security: [{ bearer: [] }],
    paths: {
      "/account": { get: { summary: "Current account", responses: { 200: ok({ $ref: "#/components/schemas/Account" }), 401: err } } },
      "/servers": { get: { summary: "List servers", responses: { 200: ok(list("Server")), 401: err } } },
      "/servers/{id}": { get: { summary: "Get a server", parameters: [idParam("id", "Server id, e.g. srv-1042")], responses: { 200: ok({ $ref: "#/components/schemas/Server" }), 404: err } } },
      "/servers/{id}/actions": { post: { summary: "Power action", parameters: [idParam("id", "Server id")], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { action: { enum: ["start", "stop", "reboot"] } }, required: ["action"] } } } }, responses: { 200: ok({ type: "object", properties: { ok: { type: "boolean" } } }), 403: err, 404: err, 422: err } } },
      "/domains": { get: { summary: "List domains", responses: { 200: ok(list("Domain")) } } },
      "/domains/{id}/records": {
        get: { summary: "List DNS records", parameters: [idParam("id", "Domain id, e.g. dom-501")], responses: { 200: ok(list("Record")), 404: err } },
        post: { summary: "Create a DNS record", parameters: [idParam("id", "Domain id")], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RecordInput" } } } }, responses: { 200: ok({ $ref: "#/components/schemas/Record" }), 422: err } },
      },
      "/domains/{id}/records/{rid}": {
        put: { summary: "Replace a DNS record", parameters: [idParam("id", "Domain id"), idParam("rid", "Record id")], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RecordInput" } } } }, responses: { 200: ok({ $ref: "#/components/schemas/Record" }), 404: err, 422: err } },
        delete: { summary: "Delete a DNS record", parameters: [idParam("id", "Domain id"), idParam("rid", "Record id")], responses: { 200: ok({ type: "object", properties: { ok: { type: "boolean" } } }), 404: err } },
      },
      "/invoices": { get: { summary: "List invoices", responses: { 200: ok(list("Invoice")) } } },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "grh_…" } },
      responses: { Error: { description: "Error", content: { "application/json": { schema: { type: "object", properties: { error: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } } } } } } },
      schemas: {
        Account: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, email: { type: "string" }, balance_toman: { type: "integer" } } },
        Server: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, status: { enum: ["building", "running", "stopped", "suspended"] }, plan: { type: "string" }, cpu: { type: "integer" }, ram_gb: { type: "integer" }, disk_gb: { type: "integer" }, location: { enum: ["thr", "isf", "fra", "ams"] }, os: { type: "string" }, ipv4: { type: ["string", "null"] }, ipv6: { type: ["string", "null"] }, hostname: { type: "string" }, billing: { enum: ["monthly", "hourly"] }, monthly_price_toman: { type: "integer" }, paid_until: { type: ["string", "null"], format: "date-time" }, created_at: { type: "string", format: "date-time" } } },
        Domain: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, status: { type: "string" }, nameservers: { type: "array", items: { type: "string" } }, auto_renew: { type: "boolean" }, expires_at: { type: "string", format: "date-time" } } },
        Record: { type: "object", properties: { id: { type: "string" }, type: { type: "string" }, name: { type: "string" }, value: { type: "string" }, ttl: { type: "integer" }, priority: { type: ["integer", "null"] } } },
        RecordInput: { type: "object", required: ["type", "name", "value"], properties: { type: { enum: ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"] }, name: { type: "string", description: "@ for the apex" }, value: { type: "string" }, ttl: { type: "integer", minimum: 60, default: 3600 }, priority: { type: "integer", description: "MX/SRV only" } } },
        Invoice: { type: "object", properties: { id: { type: "string" }, status: { enum: ["unpaid", "overdue", "paid", "refunded"] }, total_toman: { type: "integer" }, created_at: { type: "string", format: "date-time" }, due_at: { type: "string", format: "date-time" }, paid_at: { type: ["string", "null"], format: "date-time" } } },
      },
    },
  };
}
