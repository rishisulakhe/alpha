import React from "react";
import { Box, Text } from "ink";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[alpha] TUI render error:", error.message);
    this.props.onError?.(error, info);
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor="red">
          <Text bold color="red">
            Alpha encountered an error.
          </Text>
          <Box marginTop={1}>
            <Text color="red">
              {this.state.error?.message ?? "Unknown error"}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Ctrl+D to quit, or restart Alpha.</Text>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}
