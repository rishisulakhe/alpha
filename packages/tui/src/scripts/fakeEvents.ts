import type { AgentEvent } from "@alpha/agent";

async function* delay<T>(items: T[], ms: number): AsyncIterable<T> {
  for (const item of items) {
    await new Promise((r) => setTimeout(r, ms));
    yield item;
  }
}

async function* streamText(text: string, chunkSize = 3, ms = 15): AsyncIterable<AgentEvent> {
  for (let i = 0; i < text.length; i += chunkSize) {
    yield {
      type: "message_delta",
      text: text.slice(i, i + chunkSize),
    } as AgentEvent;
    await new Promise((r) => setTimeout(r, ms));
  }
}

export async function* fakeAgentEvents(): AsyncIterable<AgentEvent> {
  yield { type: "agent_start" } as AgentEvent;

  yield* delay(
    [
      {
        type: "message_start",
        role: "user" as const,
      } as AgentEvent,
      {
        type: "message_end",
        message: {
          role: "user",
          content: "Create a React component that fetches and displays a list of users from an API.",
        },
      } as AgentEvent,
    ],
    200,
  );

  yield { type: "turn_start", turn: 1 } as AgentEvent;
  yield { type: "message_start", role: "assistant" as const } as AgentEvent;

  yield* streamText("Let me think about this request. The user wants a React component for fetching user data.", 4, 20);

  yield* delay(
    [
      { type: "thinking_delta", text: "Analyzing the requirements. Need to handle loading, error, and data states. Should use useEffect for the fetch. Should use useState for users, loading, and error states. TypeScript types for User interface." } as AgentEvent,
    ],
    100,
  );

  yield* streamText("\n\nI'll create a UsersList component with proper TypeScript types, loading states, error handling, and a clean UI.", 5, 15);

  const assistantMsg = {
    role: "assistant" as const,
    content:
      "Let me think about this request. The user wants a React component for fetching user data.\n\nI'll create a UsersList component with proper TypeScript types, loading states, error handling, and a clean UI.",
    tool_calls: [
      { id: "call_1", name: "write", arguments: { filePath: "src/components/UsersList.tsx", content: "import { useState, useEffect } from 'react';\n\ninterface User {\n  id: number;\n  name: string;\n  email: string;\n}\n\nexport function UsersList() {\n  const [users, setUsers] = useState<User[]>([]);\n  const [loading, setLoading] = useState(true);\n  const [error, setError] = useState<string | null>(null);\n\n  useEffect(() => {\n    fetch('/api/users')\n      .then(r => r.json())\n      .then(data => {\n        setUsers(data);\n        setLoading(false);\n      })\n      .catch(err => {\n        setError(err.message);\n        setLoading(false);\n      });\n  }, []);\n\n  if (loading) return <div>Loading...</div>;\n  if (error) return <div>Error: {error}</div>;\n\n  return (\n    <ul>\n      {users.map(u => (\n        <li key={u.id}>{u.name} — {u.email}</li>\n      ))}\n    </ul>\n  );\n}" } },
    ],
  };

  yield { type: "message_end", message: assistantMsg } as AgentEvent;

  yield* delay(
    [
      { type: "tool_execution_start", call: assistantMsg.tool_calls[0] } as AgentEvent,
    ],
    300,
  );

  await new Promise((r) => setTimeout(r, 500));

  yield {
    type: "tool_execution_end",
    result: {
      toolCallId: "call_1",
      name: "write",
      ok: true,
      content: "File written: src/components/UsersList.tsx (45 lines, 1.2 KB)",
    },
  } as AgentEvent;

  yield { type: "turn_end", turn: 1 } as AgentEvent;

  yield { type: "turn_start", turn: 2 } as AgentEvent;
  yield { type: "message_start", role: "assistant" as const } as AgentEvent;

  yield* streamText("Now let me run the build to make sure everything compiles.", 4, 20);

  const assistantMsg2 = {
    role: "assistant" as const,
    content: "Now let me run the build to make sure everything compiles.",
    tool_calls: [{ id: "call_2", name: "bash", arguments: { command: "npm run build", timeoutSeconds: 30 } }],
  };

  yield { type: "message_end", message: assistantMsg2 } as AgentEvent;

  yield* delay(
    [{ type: "tool_execution_start", call: assistantMsg2.tool_calls[0] } as AgentEvent],
    200,
  );

  await new Promise((r) => setTimeout(r, 300));

  yield {
    type: "tool_execution_end",
    result: {
      toolCallId: "call_2",
      name: "bash",
      ok: false,
      content: "Exit code 1: Module not found: '@/types'\n\n  src/components/UsersList.tsx:1\n  Could not resolve '@/types'",
      error: "Module not found: '@/types'",
    },
  } as AgentEvent;

  yield* delay(
    [
      {
        type: "error",
        message: "Build failed due to missing type imports.",
        recoverable: false,
      } as AgentEvent,
    ],
    200,
  );

  yield { type: "turn_end", turn: 2 } as AgentEvent;
  yield { type: "agent_end" } as AgentEvent;
}
