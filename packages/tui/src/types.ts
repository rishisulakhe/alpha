export type ChatRole = "user" | "assistant" | "tool" | "thinking" | "error" | "status";

export interface ChatItem {
  id: number;
  role: ChatRole;
  text: string;
  toolName?: string;
  toolOk?: boolean;
  toolResultText?: string;
  streaming?: boolean;
  collapsed?: boolean;
}
