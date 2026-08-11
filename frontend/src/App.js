import { useState, useEffect } from "react";
import Chat from "./Chat";
import Login from "./Login";
import { getToken, clearToken, authFetch } from "./authFetch";

function App() {
  const [loggedIn, setLoggedIn] = useState(!!getToken());
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState("");
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

  const handleProjectChange = (e) => {
    if (e.target.value === "__new__") {
      setNewProjectName("");
      setShowNewProjectModal(true);
      return;
    }

    setCurrentProject(e.target.value);
  };

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
      <div className="app-topbar">
        {!loadingProjects && (
          <select value={currentProject} onChange={handleProjectChange} style={{ marginRight: 12 }}>
            {projects.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
            <option value="__new__">+ New Project</option>
          </select>
        )}
        {currentProject && (
          <button
            className="delete-project-btn"
            onClick={handleDeleteProject}
            style={{ marginRight: 12 }}
          >
            delete project
          </button>
        )}
        <button
          className="logout-btn"
          onClick={() => { clearToken(); setLoggedIn(false); }}
        >
          logout
        </button>
      </div>
      {currentProject && <Chat currentProject={currentProject} />}
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
