"""
Conductor Python SDK

The official Python client for Conductor — the AI Tool Hub.
Connect to any Conductor MCP server and call 100+ tools programmatically.

Installation:
    pip install conductor-python

Usage:
    from conductor import Conductor

    client = Conductor()
    result = client.tools.call("shell_list_dir", {"path": "."})
    print(result)
"""

from __future__ import annotations

import json
import subprocess
import threading
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ToolResult:
    """Result from a tool call."""
    success: bool
    data: Any
    error: Optional[str] = None
    latency_ms: Optional[int] = None


@dataclass
class HealthStatus:
    """Health check response."""
    status: str
    version: str
    uptime: int
    components: list[dict] = field(default_factory=list)


class ConductorError(Exception):
    """Base exception for Conductor errors."""
    pass


class CircuitOpenError(ConductorError):
    """Raised when a tool's circuit breaker is open."""
    pass


class Conductor:
    """
    Conductor client.

    Connects to a Conductor MCP server via stdio subprocess.
    All tool calls are automatically retried on transient failures.

    Args:
        command: Path to the conductor binary (default: "conductor")
        args: Additional arguments (default: ["mcp", "start"])
        timeout: Default timeout in seconds (default: 60)
        max_retries: Maximum retry attempts (default: 3)

    Example:
        >>> from conductor import Conductor
        >>> client = Conductor()
        >>> result = client.tools.call("shell_list_dir", {"path": "."})
        >>> print(result.data)
    """

    def __init__(
        self,
        command: str = "conductor",
        args: list[str] | None = None,
        timeout: int = 60,
        max_retries: int = 3,
    ):
        self._command = command
        self._args = args or ["mcp", "start"]
        self._timeout = timeout
        self._max_retries = max_retries
        self._process: Optional[subprocess.Popen] = None
        self._request_id = 0
        self._lock = threading.Lock()

    @property
    def tools(self) -> ToolClient:
        """Access the tool client."""
        return ToolClient(self)

    @property
    def health(self) -> HealthClient:
        """Access the health client."""
        return HealthClient(self)

    def _ensure_process(self) -> subprocess.Popen:
        """Start the Conductor subprocess if not already running."""
        if self._process is None or self._process.poll() is not None:
            self._process = subprocess.Popen(
                [self._command] + self._args,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
            )
        return self._process

    def _send_request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Send a JSON-RPC request to the MCP server."""
        import time

        with self._lock:
            self._request_id += 1
            request_id = self._request_id

        request = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params or {},
        }

        last_error: Optional[Exception] = None

        for attempt in range(self._max_retries):
            try:
                process = self._ensure_process()
                start = time.monotonic()

                # Send request
                process.stdin.write(json.dumps(request) + "\n")  # type: ignore
                process.stdin.flush()  # type: ignore

                # Read response
                response_line = process.stdout.readline()  # type: ignore
                if not response_line:
                    raise ConductorError("Connection closed")

                response = json.loads(response_line)
                latency_ms = int((time.monotonic() - start) * 1000)

                if "error" in response:
                    error_msg = response["error"].get("message", "Unknown error")
                    if "circuit" in error_msg.lower():
                        raise CircuitOpenError(error_msg)
                    raise ConductorError(error_msg)

                return response.get("result"), latency_ms

            except (BrokenPipeError, ConnectionResetError, OSError) as e:
                last_error = e
                self._process = None  # Force restart on next call
                time.sleep(min(2 ** attempt * 0.5, 5))  # Exponential backoff
                continue

        raise ConductorError(f"Failed after {self._max_retries} retries: {last_error}")

    def close(self) -> None:
        """Close the connection to Conductor."""
        if self._process and self._process.poll() is None:
            self._process.terminate()
            self._process.wait(timeout=5)
            self._process = None

    def __enter__(self) -> Conductor:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


class ToolClient:
    """Tool calling client."""

    def __init__(self, conductor: Conductor):
        self._conductor = conductor

    def call(self, name: str, args: dict[str, Any] | None = None) -> ToolResult:
        """
        Call a Conductor tool.

        Args:
            name: Tool name (e.g. "shell_list_dir", "github_repo")
            args: Tool arguments

        Returns:
            ToolResult with success status and data

        Example:
            >>> result = client.tools.call("shell_list_dir", {"path": "."})
            >>> if result.success:
            ...     print(result.data)
        """
        try:
            data, latency_ms = self._conductor._send_request(
                "tools/call",
                {"name": name, "arguments": args or {}},
            )
            return ToolResult(success=True, data=data, latency_ms=latency_ms)
        except ConductorError as e:
            return ToolResult(success=False, data=None, error=str(e))

    def list(self) -> list[dict[str, Any]]:
        """List all available tools."""
        result, _ = self._conductor._send_request("tools/list")
        return result.get("tools", [])


class HealthClient:
    """Health check client."""

    def __init__(self, conductor: Conductor):
        self._conductor = conductor

    def check(self) -> HealthStatus:
        """Get health status."""
        result, _ = self._conductor._send_request("conductor_health")
        return HealthStatus(
            status=result.get("status", "unknown"),
            version=result.get("version", "unknown"),
            uptime=result.get("uptime", 0),
            components=result.get("components", []),
        )
