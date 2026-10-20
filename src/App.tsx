import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

function App() {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const unlisten = listen<boolean>("notch-hover", (e) => setExpanded(e.payload));
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  return (
    <div className="stage">
      <div className={`notch ${expanded ? "expanded" : ""}`}>
        {expanded && <div className="content">Halo dari notch 👋</div>}
      </div>
    </div>
  );
}

export default App;