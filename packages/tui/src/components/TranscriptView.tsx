import type { ChatItem } from "../types.ts";
import { ChatItem as ChatItemView } from "./ChatItem.tsx";

function makeDummyItems(): ChatItem[] {
  return [
    {
      id: 1,
      role: "user",
      text: "Create a React component that fetches and displays a list of users from an API.",
    },
    {
      id: 2,
      role: "thinking",
      text: "The user wants a React component for fetching user data. I should create a UsersList component with loading, error, and data states.",
    },
    {
      id: 3,
      role: "assistant",
      text: "I'll create a UsersList component with fetching, loading states, and proper TypeScript types.",
    },
    {
      id: 4,
      role: "tool",
      text: "\u2192 write src/components/UsersList.tsx\n// Creating file with React component...",
      toolName: "write",
      streaming: true,
    },
    {
      id: 5,
      role: "tool",
      text: "\u2713 write src/components/UsersList.tsx\nFile written (1.2 KB, 45 lines).",
      toolName: "write",
      toolOk: true,
    },
    {
      id: 6,
      role: "assistant",
      text: "I've created the component. Here's the complete code with loading, error, and data states:\n\n```tsx\nconst UsersList = () => {\n  const [users, setUsers] = useState([]);\n  useEffect(() => { fetch('/api/users').then(r => r.json()).then(setUsers); }, []);\n  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;\n};\n```\n\nThe component fetches on mount and renders a list with each user's name.",
    },
    {
      id: 7,
      role: "tool",
      text: "\u2192 bash npm run build\nBuild started...",
      toolName: "bash",
      streaming: true,
    },
    {
      id: 8,
      role: "tool",
      text: "\u2717 bash npm run build\nExit code 1: Module not found: '@/types'",
      toolName: "bash",
      toolOk: false,
    },
    {
      id: 9,
      role: "error",
      text: "Error: Build failed due to missing type imports.",
    },
    {
      id: 10,
      role: "status",
      text: "Agent run completed. 3 tool calls executed, 1 error.",
    },
  ];
}

export function TranscriptView() {
  const items = makeDummyItems();

  return (
    <scrollbox flexGrow={1}>
      <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1}>
        {items.map((item) => (
          <ChatItemView key={item.id} item={item} />
        ))}
      </box>
    </scrollbox>
  );
}
