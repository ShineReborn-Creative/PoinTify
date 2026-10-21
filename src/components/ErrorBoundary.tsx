import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Tampilan pengganti kalau isinya error. */
  fallback?: (error: Error, retry: () => void) => ReactNode;
  /** Ganti nilai ini buat nyoba render ulang (misalnya pas data berubah). */
  resetKey?: unknown;
  label?: string;
};

type State = { error: Error | null };

/**
 * Satu bagian error jangan sampai bikin seluruh notch blank. Widget atau tab
 * yang meledak cuma diganti pesan kecil, sisanya tetap jalan.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[pointify] ${this.props.label ?? "komponen"} error:`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.retry);
    return (
      <div className="boundary-error" role="alert">
        <span>{this.props.label ?? "Bagian ini"} lagi error.</span>
        <button className="btn small" onClick={this.retry}>
          Coba lagi
        </button>
      </div>
    );
  }
}
