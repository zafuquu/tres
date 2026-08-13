import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error("Swertres UI error:", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", background: "#070b10", color: "#edf3f7", display: "grid", placeItems: "center", padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
        <div style={{ maxWidth: 620, width: "100%", border: "1px solid #2d3d49", borderRadius: 16, padding: 24, background: "#0d131a" }}>
          <div style={{ color: "#38d6a0", fontSize: 11, fontWeight: 800, letterSpacing: ".12em" }}>SWERTRES INTELLIGENCE</div>
          <h1 style={{ margin: "8px 0", fontSize: 26 }}>The app hit a startup error</h1>
          <p style={{ color: "#8b9aa7", lineHeight: 1.6 }}>The page did not load normally. Reloading is safe; your locally stored ledger is not cleared by this error.</p>
          <pre style={{ marginTop: 16, whiteSpace: "pre-wrap", color: "#f1b85b", background: "#0a1016", padding: 14, borderRadius: 10, overflow: "auto", fontSize: 12 }}>{String(this.state.error?.message || this.state.error)}</pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, border: 0, borderRadius: 9, padding: "10px 14px", cursor: "pointer", fontWeight: 800, background: "#38d6a0", color: "#07110e" }}>Reload application</button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>
);
