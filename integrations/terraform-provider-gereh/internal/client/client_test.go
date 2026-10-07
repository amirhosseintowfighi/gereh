package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRecordsRoundTrip(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/domains/dom-1/records":
			var in Record
			_ = json.NewDecoder(r.Body).Decode(&in)
			in.ID = "r-9"
			_ = json.NewEncoder(w).Encode(in)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/domains/dom-1/records":
			_, _ = w.Write([]byte(`{"data":[{"id":"r-9","type":"A","name":"api","value":"1.2.3.4","ttl":300}]}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/servers/missing":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"message":"Not found"}}`))
		default:
			w.WriteHeader(http.StatusTeapot)
		}
	}))
	defer srv.Close()

	c := New(srv.URL+"/", "grh_test")
	r, err := c.CreateRecord(context.Background(), "dom-1", Record{Type: "A", Name: "api", Value: "1.2.3.4", TTL: 300})
	if err != nil || r.ID != "r-9" {
		t.Fatalf("create: %v %+v", err, r)
	}
	if gotAuth != "Bearer grh_test" {
		t.Fatalf("auth header %q", gotAuth)
	}
	got, err := c.GetRecord(context.Background(), "dom-1", "r-9")
	if err != nil || got.Value != "1.2.3.4" {
		t.Fatalf("get: %v %+v", err, got)
	}
	if _, err := c.GetRecord(context.Background(), "dom-1", "nope"); !IsNotFound(err) {
		t.Fatalf("expected not found, got %v", err)
	}
	if _, err := c.GetServer(context.Background(), "missing"); !IsNotFound(err) {
		t.Fatalf("expected 404, got %v", err)
	}
}
