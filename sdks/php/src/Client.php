<?php

/**
 * Conductor PHP SDK — The AI Tool Hub
 *
 * composer require conductor/conductor-php
 *
 * use Conductor\Client;
 *
 * $client = new Client();
 * $result = $client->tools()->call('shell_list_dir', ['path' => '.']);
 * echo json_encode($result->data);
 */

namespace Conductor;

class Client {
    private string $command;
    private array $args;
    private int $timeout;
    private int $maxRetries;
    private $process;

    public function __construct(
        string $command = 'conductor',
        array $args = ['mcp', 'start'],
        int $timeout = 60,
        int $maxRetries = 3
    ) {
        $this->command = $command;
        $this->args = $args;
        $this->timeout = $timeout;
        $this->maxRetries = $maxRetries;
    }

    public function tools(): ToolClient {
        return new ToolClient($this);
    }

    public function close(): void {
        if ($this->process) {
            proc_terminate($this->process);
            $this->process = null;
        }
    }

    public function __destruct() {
        $this->close();
    }
}

class ToolClient {
    private Client $client;

    public function __construct(Client $client) {
        $this->client = $client;
    }

    public function call(string $name, array $args = []): ToolResult {
        // TODO: Implement stdio MCP protocol client
        throw new \RuntimeException('Not implemented yet');
    }
}

class ToolResult {
    public function __construct(
        public readonly bool $success,
        public readonly mixed $data = null,
        public readonly ?string $error = null,
        public readonly ?int $latencyMs = null,
    ) {}
}
