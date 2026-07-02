import { useState, useRef } from "react";
import FileTree from "./FileTree";

function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingWrite, setPendingWrite] = useState(null);
  const [writeStatus, setWriteStatus] = useState("");
  const [pendingPlan, setPendingPlan] = useState(null);
  const [pendingDiffs, setPendingDiffs] = useState(null);
  const [planStatus, setPlanStatus] = useState("");
  const isSendingRef = useRef(false);

  const sendMessage = async () => {
    if (!input.trim() || isSendingRef.current) return;
    isSendingRef.current = true;
    setIsStreaming(true);
    setWriteStatus("");
    setPlanStatus("");

    const userMsg = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    try {
      const response = await fetch("http://localhost:5000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userMsg.content, history: messages })
      });

      const contentType = response.headers.get("Content-Type") || "";

      if (contentType.includes("application/json")) {
        const data = await response.json();

        if (data.action === "propose_write") {
          setPendingWrite(data);
        } else if (data.action === "plan_proposed") {
          setPendingPlan(data);
        } else if (data.action === "write_rejected") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Write rejected: ${data.reason}` }
          ]);
        } else if (data.action === "plan_rejected") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Plan rejected: ${data.reason}` }
          ]);
        } else if (data.action === "fact_remembered") {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: data.alreadyKnown
                ? `Already remembered: "${data.fact}"`
                : `Got it, I'll remember: "${data.fact}" (${data.totalFacts} facts stored)`
            }
          ]);
        } else if (data.action === "remember_rejected") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Couldn't remember that: ${data.reason}` }
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${data.reason || data.error || "Unknown error"}` }
          ]);
        }

        setIsStreaming(false);
        isSendingRef.current = false;
        return;
      }

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const data = JSON.parse(part.slice(6));

          if (data.token) {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1].content += data.token;
              return updated;
            });
          }
          if (data.done) {
            setIsStreaming(false);
          }
        }
      }
    } catch (err) {
      console.error("Chat error:", err);
      setIsStreaming(false);
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  };

  const approveWrite = async () => {
    if (!pendingWrite) return;
    setWriteStatus("Writing...");

    try {
      const response = await fetch("http://localhost:5000/api/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetPath: pendingWrite.targetPath,
          content: pendingWrite.after
        })
      });

      const result = await response.json();

      if (result.success) {
        setWriteStatus(
          `Saved ${pendingWrite.targetPath} (${result.bytesWritten} bytes)` +
            (result.backupCreated ? " — previous version backed up" : "")
        );
      } else {
        setWriteStatus(`Write failed: ${result.error || result.reason}`);
      }
    } catch (err) {
      setWriteStatus(`Write failed: ${err.message}`);
    } finally {
      setPendingWrite(null);
    }
  };

  const rejectWrite = () => {
    setPendingWrite(null);
    setWriteStatus("Write discarded — nothing was saved.");
  };

  const approvePlan = async () => {
    if (!pendingPlan) return;
    setPlanStatus("Generating diffs for each file...");

    try {
      const response = await fetch("http://localhost:5000/api/plan/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: pendingPlan.planId })
      });

      const result = await response.json();

      if (result.success) {
        setPendingPlan(null);
        setPendingDiffs(result);
        setPlanStatus("");
      } else {
        setPlanStatus(`Plan approval failed: ${result.reason || result.error}`);
      }
    } catch (err) {
      setPlanStatus(`Plan approval failed: ${err.message}`);
    }
  };

  const rejectPlan = async () => {
    if (!pendingPlan) return;

    try {
      await fetch("http://localhost:5000/api/plan/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: pendingPlan.planId })
      });
    } catch (err) {
      console.error("Reject plan failed:", err);
    } finally {
      setPendingPlan(null);
      setPlanStatus("Plan rejected — nothing was written.");
    }
  };

  const applyPlan = async () => {
    if (!pendingDiffs) return;
    setPlanStatus("Applying all files...");

    try {
      const response = await fetch("http://localhost:5000/api/plan/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: pendingDiffs.planId })
      });

      const result = await response.json();

      if (result.success) {
        const summary = result.filesWritten
          .map((f) => `${f.path} (${f.bytesWritten} bytes)`)
          .join(", ");
        setPlanStatus(`Applied: ${summary}`);
      } else {
        setPlanStatus(`Apply failed at ${result.reason}`);
      }
    } catch (err) {
      setPlanStatus(`Apply failed: ${err.message}`);
    } finally {
      setPendingDiffs(null);
    }
  };

  const rejectDiffs = async () => {
    if (!pendingDiffs) return;

    try {
      await fetch("http://localhost:5000/api/plan/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: pendingDiffs.planId })
      });
    } catch (err) {
      console.error("Reject diffs failed:", err);
    } finally {
      setPendingDiffs(null);
      setPlanStatus("Plan rejected — nothing was written.");
    }
  };

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: 16, fontFamily: "sans-serif" }}>
      <h2>Taifa AI</h2>
      <FileTree />

      <div style={{ minHeight: 300, border: "1px solid #ccc", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        {messages.length === 0 && !pendingWrite && !pendingPlan && !pendingDiffs && (
          <p style={{ color: "#888" }}>Start a conversation...</p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ margin: "10px 0" }}>
            <strong>{m.role === "user" ? "You" : "Taifa"}:</strong> {m.content}
          </div>
        ))}
      </div>

      {pendingWrite && (
        <div style={{ border: "2px solid #e0a800", borderRadius: 8, padding: 12, marginBottom: 16, background: "#fffbea" }}>
          <p style={{ margin: "0 0 8px 0", fontWeight: "bold" }}>
            Proposed {pendingWrite.mode === "edit" ? "edit" : "new file"}: {pendingWrite.targetPath}
          </p>
          {pendingWrite.locationMethod && (
            <p style={{ margin: "0 0 8px 0", fontSize: 12, color: pendingWrite.locationMethod === "stack_trace" ? "#28a745" : "#e0a800" }}>
              {pendingWrite.locationMethod === "stack_trace"
                ? "📍 Found via stack trace"
                : "🔍 Best guess via keyword search — review carefully"}
            </p>
          )}
          {pendingWrite.isDocumentation && (
            <p style={{ margin: "0 0 8px 0", fontSize: 12, color: "#e0a800", fontWeight: "bold" }}>
              ⚠️ AI-generated documentation — technical claims (libraries, frameworks, architecture) may be inaccurate. Verify against the actual file content below before approving.
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>BEFORE</div>
              <pre style={{ background: "#f5f5f5", padding: 8, borderRadius: 4, fontSize: 12, overflowX: "auto", minHeight: 60 }}>
                {pendingWrite.before || "(new file — no previous content)"}
              </pre>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>AFTER</div>
              <pre style={{ background: "#eafbea", padding: 8, borderRadius: 4, fontSize: 12, overflowX: "auto", minHeight: 60 }}>
                {pendingWrite.after}
              </pre>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={approveWrite} style={{ background: "#28a745", color: "white", border: "none", padding: "8px 16px", borderRadius: 4 }}>
              Approve
            </button>
            <button onClick={rejectWrite} style={{ background: "#dc3545", color: "white", border: "none", padding: "8px 16px", borderRadius: 4 }}>
              Reject
            </button>
          </div>
        </div>
      )}

      {pendingPlan && (
        <div style={{ border: "2px solid #0d6efd", borderRadius: 8, padding: 12, marginBottom: 16, background: "#f0f4ff" }}>
          <p style={{ margin: "0 0 8px 0", fontWeight: "bold" }}>
            📋 Proposed plan: {pendingPlan.description}
          </p>
          {pendingPlan.truncated && (
            <p style={{ margin: "0 0 8px 0", fontSize: 12, color: "#dc3545", fontWeight: "bold" }}>
              ⚠️ Plan was truncated to 5 files. Dropped: {pendingPlan.truncatedFiles?.join(", ")}
            </p>
          )}
          <div style={{ marginBottom: 8 }}>
            {pendingPlan.files.map((f, i) => (
              <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #dde" }}>
                <div style={{ fontSize: 13, fontWeight: "bold" }}>{f.path}</div>
                <div style={{ fontSize: 12, color: "#555" }}>{f.description}</div>
              </div>
            ))}
          </div>
          <p style={{ margin: "0 0 8px 0", fontSize: 12, color: "#555" }}>
            Approving will generate code for each file above. You will review all diffs before anything is written to disk.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={approvePlan} style={{ background: "#0d6efd", color: "white", border: "none", padding: "8px 16px", borderRadius: 4 }}>
              Approve Plan
            </button>
            <button onClick={rejectPlan} style={{ background: "#dc3545", color: "white", border: "none", padding: "8px 16px", borderRadius: 4 }}>
              Reject Plan
            </button>
          </div>
        </div>
      )}

      {pendingDiffs && (
        <div style={{ border: "2px solid #198754", borderRadius: 8, padding: 12, marginBottom: 16, background: "#f0fff4" }}>
          <p style={{ margin: "0 0 12px 0", fontWeight: "bold" }}>
            📝 Review all diffs — {pendingDiffs.files.length} file{pendingDiffs.files.length > 1 ? "s" : ""}
          </p>
          {pendingDiffs.files.map((f, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: "bold", marginBottom: 4 }}>
                {f.mode === "edit" ? "✏️ Edit" : "➕ New"}: {f.path}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>BEFORE</div>
                  <pre style={{ background: "#f5f5f5", padding: 8, borderRadius: 4, fontSize: 11, overflowX: "auto", minHeight: 40, margin: 0 }}>
                    {f.before || "(new file — no previous content)"}
                  </pre>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>AFTER</div>
                  <pre style={{ background: "#eafbea", padding: 8, borderRadius: 4, fontSize: 11, overflowX: "auto", minHeight: 40, margin: 0 }}>
                    {f.after}
                  </pre>
                </div>
              </div>
            </div>
          ))}
          <p style={{ margin: "0 0 8px 0", fontSize: 12, color: "#555" }}>
            This is all-or-nothing. Approving writes all files; rejecting writes none.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={applyPlan} style={{ background: "#198754", color: "white", border: "none", padding: "8px 16px", borderRadius: 4 }}>
              Apply All
            </button>
            <button onClick={rejectDiffs} style={{ background: "#dc3545", color: "white", border: "none", padding: "8px 16px", borderRadius: 4 }}>
              Reject All
            </button>
          </div>
        </div>
      )}

      {writeStatus && (
        <div style={{ marginBottom: 16, color: "#555", fontSize: 14 }}>{writeStatus}</div>
      )}

      {planStatus && (
        <div style={{ marginBottom: 16, color: "#555", fontSize: 14 }}>{planStatus}</div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          autoCapitalize="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          placeholder="Ask something, or: plan: what to build"
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={sendMessage} disabled={isStreaming}>
          {isStreaming ? "Thinking..." : "Send"}
        </button>
      </div>
    </div>
  );
}

export default Chat;
