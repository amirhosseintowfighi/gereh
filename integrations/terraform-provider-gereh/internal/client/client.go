// Package client is a small HTTP client for the Gereh public API (/api/v1).
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	Endpoint string
	Token    string
	HTTP     *http.Client
}

func New(endpoint, token string) *Client {
	return &Client{Endpoint: strings.TrimRight(endpoint, "/"), Token: token, HTTP: &http.Client{Timeout: 60 * time.Second}}
}

// APIError is returned for non-2xx responses.
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string { return fmt.Sprintf("gereh api: %d %s", e.Status, e.Message) }

// IsNotFound reports whether err is a 404 from the API.
func IsNotFound(err error) bool {
	if e, ok := err.(*APIError); ok {
		return e.Status == http.StatusNotFound
	}
	return false
}

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.Endpoint+"/api/v1/"+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "terraform-provider-gereh")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode >= 300 {
		var e struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		if e.Error.Message == "" {
			e.Error.Message = http.StatusText(res.StatusCode)
		}
		return &APIError{Status: res.StatusCode, Message: e.Error.Message}
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

type Server struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Status   string  `json:"status"`
	Plan     string  `json:"plan"`
	CPU      int64   `json:"cpu"`
	RAMGB    int64   `json:"ram_gb"`
	DiskGB   int64   `json:"disk_gb"`
	Location string  `json:"location"`
	OS       string  `json:"os"`
	IPv4     *string `json:"ipv4"`
	IPv6     *string `json:"ipv6"`
	Hostname string  `json:"hostname"`
}

type Record struct {
	ID       string `json:"id,omitempty"`
	Type     string `json:"type"`
	Name     string `json:"name"`
	Value    string `json:"value"`
	TTL      int64  `json:"ttl"`
	Priority *int64 `json:"priority,omitempty"`
}

func (c *Client) GetServer(ctx context.Context, id string) (*Server, error) {
	var s Server
	return &s, c.do(ctx, http.MethodGet, "servers/"+id, nil, &s)
}

func (c *Client) ListRecords(ctx context.Context, domainID string) ([]Record, error) {
	var out struct {
		Data []Record `json:"data"`
	}
	return out.Data, c.do(ctx, http.MethodGet, "domains/"+domainID+"/records", nil, &out)
}

func (c *Client) GetRecord(ctx context.Context, domainID, id string) (*Record, error) {
	list, err := c.ListRecords(ctx, domainID)
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].ID == id {
			return &list[i], nil
		}
	}
	return nil, &APIError{Status: http.StatusNotFound, Message: "record not found"}
}

func (c *Client) CreateRecord(ctx context.Context, domainID string, r Record) (*Record, error) {
	var out Record
	return &out, c.do(ctx, http.MethodPost, "domains/"+domainID+"/records", r, &out)
}

func (c *Client) UpdateRecord(ctx context.Context, domainID string, r Record) (*Record, error) {
	var out Record
	return &out, c.do(ctx, http.MethodPut, "domains/"+domainID+"/records/"+r.ID, r, &out)
}

func (c *Client) DeleteRecord(ctx context.Context, domainID, id string) error {
	return c.do(ctx, http.MethodDelete, "domains/"+domainID+"/records/"+id, nil, nil)
}
