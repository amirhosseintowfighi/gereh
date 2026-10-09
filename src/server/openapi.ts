/** OpenAPI 3.1 description of /api/v1 (served at /api/v1/openapi.json) */
export function openapi(origin: string) {
  const err = { $ref: "#/components/responses/Error" };
  const ok = (schema: object, description = "OK") => ({ description, content: { "application/json": { schema } } });
  const list = (ref: string) => ({ type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/" + ref } } }, required: ["data"] });
  const idParam = (name: string, description: string) => ({ name, in: "path", required: true, schema: { type: "string" }, description });
  return {
    openapi: "3.1.0",
    info: { title: "Gereh Cloud API", version: "1.0.0", description: "Manage Gereh cloud servers, apps (PaaS), DNS and billing. Create a token in Panel › SSH و API. Read tokens may only use GET. Limit: 120 requests per minute per token. Amounts are in Toman." },
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
      "/apps": { get: { summary: "List apps", responses: { 200: ok(list("App")) } } },
      "/databases": { get: { summary: "List managed databases", responses: { 200: ok({ type: "object", properties: { data: { type: "array", items: { type: "object" } } } }) } } },
      "/apps/{app}": { get: { summary: "Get an app", parameters: [idParam("app", "App id (app-…) or name")], responses: { 200: ok({ $ref: "#/components/schemas/App" }), 404: err } } },
      "/apps/{app}/deployments": { post: { summary: "Start a deployment", description: "Git and image apps rebuild from their source. ZIP apps need upload_id from POST /api/paas/upload (multipart field `file`, same bearer token).", parameters: [idParam("app", "App id or name")], requestBody: { content: { "application/json": { schema: { type: "object", properties: { upload_id: { type: "string" }, message: { type: "string", maxLength: 200 } } } } } }, responses: { 200: ok({ type: "object", properties: { id: { type: "string" }, status: { const: "queued" } } }), 403: err, 404: err, 422: err } } },
      "/apps/{app}/deployments/{id}": { get: { summary: "Deployment status and build log", parameters: [idParam("app", "App id or name"), idParam("id", "Deployment id")], responses: { 200: ok({ $ref: "#/components/schemas/Deployment" }), 404: err } } },
      "/apps/{app}/jobs": { post: { summary: "Run a one-off command from the live image", parameters: [idParam("app", "App id or name")], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { command: { type: "string", maxLength: 1000 } }, required: ["command"] } } } }, responses: { 200: ok({ type: "object", properties: { id: { type: "string" }, status: { const: "running" } } }), 422: err } } },
      "/apps/{app}/jobs/{id}": { get: { summary: "Job status and output", parameters: [idParam("app", "App id or name"), idParam("id", "Job id")], responses: { 200: ok({ type: "object", properties: { status: { enum: ["running", "succeeded", "failed"] }, output: { type: "string" } } }), 404: err } } },
      "/apps/{app}/logs": { get: { summary: "Recent runtime log lines", parameters: [idParam("app", "App id or name")], responses: { 200: ok({ type: "object", properties: { lines: { type: "array", items: { type: "string" } } } }), 404: err } } },
      "/apps/{app}/env": { put: { summary: "Set or remove environment variables (applies with a restart, no rebuild)", parameters: [idParam("app", "App id or name")], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { vars: { type: "object", additionalProperties: { type: ["string", "null"] }, description: "null removes the variable" }, secret: { type: "array", items: { type: "string" }, description: "keys to store as secrets" } }, required: ["vars"] } } } }, responses: { 200: ok({ type: "object", properties: { ok: { type: "boolean" } } }), 422: err } } },
      "/apps/{app}/actions": { post: { summary: "Start, stop or restart", parameters: [idParam("app", "App id or name")], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { action: { enum: ["start", "stop", "restart"] } }, required: ["action"] } } } }, responses: { 200: ok({ type: "object", properties: { ok: { type: "boolean" } } }), 422: err } } },
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
        App: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, status: { enum: ["creating", "building", "running", "stopped", "failed", "suspended"] }, stack: { type: "string" }, source: { enum: ["git", "zip", "image", "compose"] }, url: { type: "string" }, domains: { type: "array", items: { type: "object", properties: { host: { type: "string" }, status: { type: "string" } } } }, plan: { type: "string" }, instances: { type: "integer" }, autoscale: { type: "boolean" }, max_instances: { type: "integer" }, disk_gb: { type: "integer" }, hourly_price_toman: { type: ["integer", "null"] }, live_deployment: { type: ["string", "null"] }, latest_deployment: { type: ["object", "null"] }, created_at: { type: "string", format: "date-time" } } },
        Deployment: { type: "object", properties: { id: { type: "string" }, status: { enum: ["queued", "building", "deploying", "live", "failed", "superseded", "cancelled"] }, trigger: { type: "string" }, ref: { type: ["string", "null"] }, message: { type: "string" }, log: { type: "string" }, created_at: { type: "string", format: "date-time" }, finished_at: { type: ["string", "null"], format: "date-time" } } },
        Invoice: { type: "object", properties: { id: { type: "string" }, status: { enum: ["unpaid", "overdue", "paid", "refunded"] }, total_toman: { type: "integer" }, created_at: { type: "string", format: "date-time" }, due_at: { type: "string", format: "date-time" }, paid_at: { type: ["string", "null"], format: "date-time" } } },
      },
    },
  };
}
