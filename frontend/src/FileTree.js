import { useState } from "react";
import { authFetch } from "./authFetch";

function TreeNode({ node, depth }) {
  const [expanded, setExpanded] = useState(depth === 0);

  if (node.type === "file") {
    return (
      <div style={{ paddingLeft: depth * 16 + 8, fontSize: 13, padding: "2px 0" }}>
        📄 {node.name}
      </div>
    );
  }

  return (
    <div>
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{ paddingLeft: depth * 16, fontSize: 13, padding: "2px 0", cursor: "pointer", fontWeight: "bold" }}
      >
        {expanded ? "📂" : "📁"} {node.name}
      </div>
      {expanded &&
        node.children &&
        node.children.map((child) => (
          <TreeNode key={child.path} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

function FileTree({ currentProject }) {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);

  const loadTree = async () => {
    setLoading(true);
    try {
      const url = `http://localhost:5000/api/files?projectName=${encodeURIComponent(currentProject)}`;
      const response = await authFetch(url);
      const data = await response.json();
      if (data.success) {
        setTree(data.tree);
      }
    } catch (err) {
      console.error("Failed to load file tree:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleVisible = () => {
    const next = !visible;
    setVisible(next);
    if (next) {
      loadTree();
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={toggleVisible} style={{ fontSize: 13, padding: "6px 12px" }}>
        {visible ? "Hide files" : "Show project files"}
      </button>

      {visible && (
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginTop: 8, maxHeight: 250, overflowY: "auto" }}>
          {loading && <p style={{ fontSize: 13, color: "#888" }}>Loading...</p>}
          {!loading && tree.length === 0 && (
            <p style={{ fontSize: 13, color: "#888" }}>No files in workspace yet.</p>
          )}
          {!loading &&
            tree.map((node) => <TreeNode key={node.path} node={node} depth={0} />)}
        </div>
      )}
    </div>
  );
}

export default FileTree;
