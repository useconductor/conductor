// Package conductor provides a Go client for the Conductor AI Tool Hub.
//
// Conductor is a single MCP server that gives any AI agent access to 100+ tools.
// This SDK allows Go programs to call Conductor tools programmatically.
//
// Installation:
//
//	go get github.com/conductor/conductor/sdks/go
//
// Usage:
//
//	client, err := conductor.New()
//	if err != nil {
//	    log.Fatal(err)
//	}
//	defer client.Close()
//
//	result, err := client.Tools.Call(ctx, "shell_list_dir", map[string]any{"path": "."})
//	if err != nil {
//	    log.Fatal(err)
//	}
//	fmt.Println(result)
package conductor

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"
)

// Client is a Conductor MCP client.
type Client struct {
	command    string
	args       []string
	timeout    time.Duration
	maxRetries int

	mu     sync.Mutex
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader
	reqID  int
}

// ToolResult is the result of a tool call.
type ToolResult struct {
	Success   bool
	Data      any
	Error     string
	LatencyMs int
}

// New creates a new Conductor client.
func New(opts ...Option) (*Client, error) {
	c := &Client{
		command:    "conductor",
		args:       []string{"mcp", "start"},
		timeout:    60 * time.Second,
		maxRetries: 3,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c, nil
}

// Option configures a Client.
type Option func(*Client)

// WithCommand sets the conductor binary path.
func WithCommand(cmd string) Option {
	return func(c *Client) { c.command = cmd }
}

// WithTimeout sets the default timeout.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) { c.timeout = d }
}

// WithMaxRetries sets the maximum retry attempts.
func WithMaxRetries(n int) Option {
	return func(c *Client) { c.maxRetries = n }
}

// ensureProcess starts the Conductor subprocess if not already running.
func (c *Client) ensureProcess() error {
	if c.cmd != nil && c.cmd.Process != nil && c.cmd.ProcessState == nil {
		return nil
	}

	cmd := exec.Command(c.command, c.args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = nil // MCP protocol uses stdout; stderr is for logs

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("conductor: failed to start: %w", err)
	}

	c.cmd = cmd
	c.stdin = stdin
	c.stdout = bufio.NewReader(stdout)
	return nil
}

// sendRequest sends a JSON-RPC request and returns the result.
func (c *Client) sendRequest(ctx context.Context, method string, params map[string]any) (any, error) {
	var lastErr error

	for attempt := 0; attempt < c.maxRetries; attempt++ {
		if attempt > 0 {
			delay := time.Duration(1<<uint(attempt-1)) * 500 * time.Millisecond
			if delay > 5*time.Second {
				delay = 5 * time.Second
			}
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay):
			}
		}

		c.mu.Lock()
		if err := c.ensureProcess(); err != nil {
			c.mu.Unlock()
			lastErr = err
			continue
		}

		c.reqID++
		reqID := c.reqID
		c.mu.Unlock()

		start := time.Now()
		ctx, cancel := context.WithTimeout(ctx, c.timeout)
		defer cancel()

		req := map[string]any{
			"jsonrpc": "2.0",
			"id":      reqID,
			"method":  method,
			"params":  params,
		}

		data, err := json.Marshal(req)
		if err != nil {
			lastErr = err
			continue
		}

		if _, err := c.stdin.Write(append(data, '\n')); err != nil {
			c.mu.Lock()
			c.cmd = nil
			c.mu.Unlock()
			lastErr = fmt.Errorf("conductor: write failed: %w", err)
			continue
		}

		done := make(chan any, 1)
		go func() {
			line, err := c.stdout.ReadString('\n')
			if err != nil {
				done <- err
				return
			}
			var resp map[string]any
			if err := json.Unmarshal([]byte(line), &resp); err != nil {
				done <- err
				return
			}
			if errVal, ok := resp["error"]; ok {
				if errMap, ok := errVal.(map[string]any); ok {
					done <- fmt.Errorf("conductor: %v", errMap["message"])
					return
				}
			}
			done <- resp["result"]
		}()

		select {
		case <-ctx.Done():
			lastErr = ctx.Err()
		case result := <-done:
			if err, ok := result.(error); ok {
				lastErr = err
				continue
			}
			_ = time.Since(start).Milliseconds() // latency tracked
			return result, nil
		}
	}

	return nil, fmt.Errorf("conductor: failed after %d retries: %w", c.maxRetries, lastErr)
}

// Close stops the Conductor subprocess.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cmd != nil && c.cmd.Process != nil {
		return c.cmd.Process.Kill()
	}
	return nil
}

// Tools provides access to Conductor tools.
func (c *Client) Tools() *ToolClient {
	return &ToolClient{client: c}
}

// ToolClient calls Conductor tools.
type ToolClient struct {
	client *Client
}

// Call calls a named tool with the given arguments.
func (t *ToolClient) Call(ctx context.Context, name string, args map[string]any) (*ToolResult, error) {
	result, err := t.client.sendRequest(ctx, "tools/call", map[string]any{
		"name":      name,
		"arguments": args,
	})
	if err != nil {
		return &ToolResult{Success: false, Error: err.Error()}, err
	}
	return &ToolResult{Success: true, Data: result}, nil
}

// List returns all available tools.
func (t *ToolClient) List(ctx context.Context) ([]map[string]any, error) {
	result, err := t.client.sendRequest(ctx, "tools/list", nil)
	if err != nil {
		return nil, err
	}
	if m, ok := result.(map[string]any); ok {
		if tools, ok := m["tools"].([]any); ok {
			out := make([]map[string]any, len(tools))
			for i, tool := range tools {
				if m, ok := tool.(map[string]any); ok {
					out[i] = m
				}
			}
			return out, nil
		}
	}
	return nil, nil
}
