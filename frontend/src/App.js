import { useState, useEffect } from "react";
import Chat from "./Chat";
import LearningChat from "./LearningChat";
import Login from "./Login";
import AccountSettings from "./AccountSettings";
import { getToken, clearToken, authFetch } from "./authFetch";

function App() {
  const [loggedIn, setLoggedIn] = useState(!!getToken());
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState("");
  const [activeMode, setActiveMode] = useState("project");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("taifa_theme") === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("taifa_theme", theme);
  }, [theme]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  useEffect(() => {
    if (!loggedIn) return;

    const loadProjects = async () => {
      setLoadingProjects(true);
      try {
        const response = await authFetch("http://localhost:5000/api/projects");
        const data = await response.json();
        if (data.success) {
          setProjects(data.projects);
          if (data.projects.length > 0) {
            setCurrentProject(data.projects[0]);
          } else {
            setNewProjectName("");
            setShowNewProjectModal(true);
          }
        }
      } catch (err) {
        console.error("Failed to load projects:", err);
      } finally {
        setLoadingProjects(false);
      }
    };

    loadProjects();
  }, [loggedIn]);

  const handleCreateProject = async () => {
    const trimmed = newProjectName.trim();

    if (!trimmed) {
      return;
    }

    try {
      const response = await authFetch("http://localhost:5000/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          projectName: trimmed
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        window.alert(data.error || "Failed to create project.");
        return;
      }

      setProjects((prev) => [...prev, data.projectName]);
      setCurrentProject(data.projectName);
      setShowNewProjectModal(false);
      setNewProjectName("");
    } catch (err) {
      console.error("Failed to create project:", err);
      window.alert("Failed to create project.");
    }
  };

  const handleDeleteProject = async () => {
    if (!currentProject) {
      return;
    }

    const confirmed = window.confirm(
      `Delete project "${currentProject}"? This permanently removes its files, memory, and backups. This cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await authFetch(
        `http://localhost:5000/api/projects/${encodeURIComponent(currentProject)}?confirm=true`,
        { method: "DELETE" }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        window.alert(data.error || "Failed to delete project.");
        return;
      }

      setProjects((prev) => prev.filter((p) => p !== currentProject));
      setCurrentProject((prev) => {
        const remaining = projects.filter((p) => p !== currentProject);
        return remaining.length > 0 ? remaining[0] : "";
      });
    } catch (err) {
      console.error("Failed to delete project:", err);
      window.alert("Failed to delete project.");
    }
  };

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />;
  }

  return (
    <div className="app-shell">
      <button
        className="mobile-menu-btn"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle navigation"
      >
        ☰
      </button>

      <aside className={`app-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">T</div>
          <div>
            <strong>TAIFA AI</strong>
            <span>INTELLIGENT WORKSPACE</span>
          </div>
        </div>

        <div className="sidebar-section-label">WORKSPACE</div>

        <button
          className={`sidebar-nav-item ${activeMode === "project" ? "active" : ""}`}
          onClick={() => { setActiveMode("project"); setSidebarOpen(false); }}
        >
          <span className="sidebar-nav-icon">⌘</span>
          <span>Project Chat</span>
        </button>

        <button
          className={`sidebar-nav-item ${activeMode === "learning" ? "active" : ""}`}
          onClick={() => { setActiveMode("learning"); setSidebarOpen(false); }}
        >
          <span className="sidebar-nav-icon">✧</span>
          <span>Learning Chat</span>
        </button>

        {activeMode === "project" && (
          <div className="sidebar-projects">
            <div className="sidebar-section-heading">
              <span>YOUR PROJECTS</span>
              <button onClick={() => { setNewProjectName(""); setShowNewProjectModal(true); }}>
                +
              </button>
            </div>

            {loadingProjects ? (
              <div className="sidebar-muted">Loading projects...</div>
            ) : projects.length === 0 ? (
              <div className="sidebar-muted">No projects yet</div>
            ) : projects.map((project) => (
              <button
                key={project}
                className={`sidebar-project-item ${currentProject === project ? "active" : ""}`}
                onClick={() => { setCurrentProject(project); setSidebarOpen(false); }}
                title={project}
              >
                <span className="project-indicator" />
                <span>{project}</span>
              </button>
            ))}
          </div>
        )}

        <div className="sidebar-appearance">
          <div className="sidebar-section-label">APPEARANCE</div>
          <div className="theme-switcher">
            <button
              className={theme === "dark" ? "theme-option active" : "theme-option"}
              onClick={() => setTheme("dark")}
              aria-pressed={theme === "dark"}
            >
              <span>☾</span> Dark
            </button>
            <button
              className={theme === "light" ? "theme-option active" : "theme-option"}
              onClick={() => setTheme("light")}
              aria-pressed={theme === "light"}
            >
              <span>☀</span> Light
            </button>
          </div>
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-account">
            <div className="account-avatar">U</div>
            <div>
              <strong>My workspace</strong>
              <span>Signed in</span>
            </div>
          </div>
          <button
            className="sidebar-logout"
            onClick={() => setShowAccountSettings(true)}
          >
            <span>⚙</span> Manage account
          </button>
          <button
            className="sidebar-logout"
            onClick={() => { clearToken(); setLoggedIn(false); }}
          >
            <span>↪</span> Sign out
          </button>
        </div>
      </aside>

      {showAccountSettings && (
        <AccountSettings onClose={() => setShowAccountSettings(false)} />
      )}

      {sidebarOpen && (
        <button
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <main className="app-main">
        <header className="workspace-header">
          <div>
            <div className="workspace-eyebrow">TAIFA AI / WORKSPACE</div>
            <h1>{activeMode === "project" ? currentProject || "Project Workspace" : "Learning Space"}</h1>
          </div>
          {activeMode === "project" && currentProject && (
            <button className="delete-project-btn" onClick={handleDeleteProject}>
              Delete project
            </button>
          )}
        </header>

        <section className="workspace-content">
          {activeMode === "project" && currentProject && (
            <Chat key={currentProject} currentProject={currentProject} />
          )}
          {activeMode === "project" && !currentProject && !loadingProjects && (
            <div className="workspace-empty">
              <h2>Create your first project</h2>
              <p>Start a dedicated workspace for your development work.</p>
              <button onClick={() => setShowNewProjectModal(true)}>+ New project</button>
            </div>
          )}
          {activeMode === "learning" && <LearningChat />}
        </section>
      </main>

      {showNewProjectModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000
          }}
        >
          <div
            style={{
              background: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: 8,
              padding: 24,
              width: "90%",
              maxWidth: 360
            }}
          >
            <div style={{ marginBottom: 12, fontSize: 16 }}>
              New project name
            </div>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateProject();
                }
              }}
              autoFocus
              style={{
                width: "100%",
                padding: 8,
                marginBottom: 16,
                boxSizing: "border-box"
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => {
                  setShowNewProjectModal(false);
                  setNewProjectName("");
                }}
              >
                cancel
              </button>
              <button onClick={handleCreateProject}>
                create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
