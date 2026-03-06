import { definePlugin, tool } from "@conductor/sdk";

const LUMEN_URL = process.env.LUMEN_URL || "http://localhost:11434";
const LUMEN_MODEL = process.env.LUMEN_MODEL || "lumen";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_shell",
      description: "Run a shell command and return stdout/stderr.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
          working_dir: { type: "string", description: "Working directory" },
          timeout: { type: "integer", description: "Timeout in seconds", default: 30 },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to read" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to write" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
];

async function callLumen(messages: any[]): Promise<any> {
  const res = await fetch(`${LUMEN_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LUMEN_MODEL,
      messages,
      tools: TOOLS,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Lumen API error: ${res.status}`);
  return res.json();
}

async function executeTool(name: string, args: any): Promise<string> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const { readFile, writeFile } = await import("fs/promises");
  const execAsync = promisify(exec);

  if (name === "run_shell") {
    try {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: args.working_dir || process.cwd(),
        timeout: (args.timeout || 30) * 1000,
      });
      return JSON.stringify({ stdout, stderr, returncode: 0 });
    } catch (e: any) {
      return JSON.stringify({ stdout: e.stdout || "", stderr: e.stderr || e.message, returncode: 1 });
    }
  }

  if (name === "read_file") {
    try {
      const content = await readFile(args.path, "utf8");
      return JSON.stringify({ content, success: true });
    } catch (e: any) {
      return JSON.stringify({ error: e.message, success: false });
    }
  }

  if (name === "write_file") {
    try {
      await writeFile(args.path, args.content, "utf8");
      return JSON.stringify({ success: true });
    } catch (e: any) {
      return JSON.stringify({ error: e.message, success: false });
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

export default definePlugin({
  name: "lumen",
  description: "Lumen — agentic AI coding assistant by TheAlxLabs",

  tools: {
    ask: tool({
      description: "Ask Lumen to complete a coding task autonomously",
      input: { task: { type: "string", description: "The task for Lumen to complete" } },
      async run({ task }) {
        const messages: any[] = [
          {
            role: "system",
            content:
              "You are Lumen, an agentic AI coding assistant built by Alexander (TheAlxLabs). You run inside Conductor. You have tools: run_shell, read_file, write_file. Think step-by-step. Use tools to verify.",
          },
          { role: "user", content: task },
        ];

        let iterations = 0;
        const MAX_ITERATIONS = 10;

        while (iterations < MAX_ITERATIONS) {
          iterations++;
          const response = await callLumen(messages);
          const message = response.message;
          messages.push(message);

          if (!message.tool_calls || message.tool_calls.length === 0) {
            return { result: message.content, iterations };
          }

          for (const toolCall of message.tool_calls) {
            const name = toolCall.function.name;
            const args =
              typeof toolCall.function.arguments === "string"
                ? JSON.parse(toolCall.function.arguments)
                : toolCall.function.arguments;

            console.log(`[Lumen] → ${name}(${JSON.stringify(args)})`);
            const result = await executeTool(name, args);
            console.log(`[Lumen] ← ${result.slice(0, 200)}`);

            messages.push({ role: "tool", content: result });
          }
        }

        return { result: "Max iterations reached.", iterations };
      },
    }),

    ping: tool({
      description: "Check if Lumen is running",
      input: {},
      async run() {
        try {
          const res = await fetch(`${LUMEN_URL}/api/tags`);
          const data = await res.json();
          const models = data.models?.map((m: any) => m.name) || [];
          const hasLumen = models.some((m: string) => m.includes("lumen"));
          return {
            status: hasLumen ? "ok" : "lumen model not found",
            models,
            url: LUMEN_URL,
          };
        } catch (e: any) {
          return { status: "error", error: e.message };
        }
      },
    }),
  },
});
