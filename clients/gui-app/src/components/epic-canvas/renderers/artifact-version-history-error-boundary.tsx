import { Component, type ErrorInfo, type ReactNode } from "react";
import { appLogger } from "@/lib/logger";

interface ArtifactVersionHistoryErrorBoundaryState {
  readonly failed: boolean;
}

export class ArtifactVersionHistoryErrorBoundary extends Component<
  { readonly children: ReactNode },
  ArtifactVersionHistoryErrorBoundaryState
> {
  constructor(props: { readonly children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): ArtifactVersionHistoryErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    appLogger.warn("[artifact-version-history] renderer failed", {
      error: error.message,
      componentStack: info.componentStack ?? null,
    });
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <span
          role="status"
          className="ml-auto text-ui-xs text-muted-foreground"
        >
          Version history unavailable
        </span>
      );
    }
    return this.props.children;
  }
}
