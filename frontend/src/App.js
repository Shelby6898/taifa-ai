import { useState, useEffect } from "react";
import Chat from "./Chat";
import Login from "./Login";
import { getToken, clearToken, authFetch } from "./authFetch";

function App() {
  const [loggedIn, setLoggedIn] = useState(!!getToken());
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(false);

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
        const name = window.prompt("Name your first project:");

        if (name && name.trim()) {
          const trimmed = name.trim();

          try {
            const createResponse = await authFetch(
              "http://localhost:5000/api/projects",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  projectName: trimmed
                })
              }
            );

            const createData = await createResponse.json();

            if (!createResponse.ok || !createData.success) {
              window.alert(
                createData.error || "Failed to create project."
              );
              return;
            }

            setProjects([createData.projectName]);
            setCurrentProject(createData.projectName);
          } catch (err) {
            console.error("Failed to create first project:", err);
            window.alert("Failed to create project.");
          }
        }
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

  const handleProjectChange = async (e) => {
    if (e.target.value === "**new**") {
      const name = window.prompt("New project name:");

      if (!name || !name.trim()) {
        return;
      }

      const trimmed = name.trim();

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
      } catch (err) {
        console.error("Failed to create project:", err);
        window.alert("Failed to create project.");
      }

      return;
    }

    setCurrentProject(e.target.value);
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
        <button
          className="logout-btn"
          onClick={() => { clearToken(); setLoggedIn(false); }}
        >
          logout
        </button>
      </div>
      {currentProject && <Chat currentProject={currentProject} />}
    </div>
  );
}

export default App;
