import { useState } from "react";
import Chat from "./Chat";
import Login from "./Login";
import { getToken, clearToken } from "./authFetch";

function App() {
  const [loggedIn, setLoggedIn] = useState(!!getToken());

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />;
  }

  return (
    <div className="app-shell">
      <div className="app-topbar">
        <button
          className="logout-btn"
          onClick={() => { clearToken(); setLoggedIn(false); }}
        >
          logout
        </button>
      </div>
      <Chat />
    </div>
  );
}

export default App;
