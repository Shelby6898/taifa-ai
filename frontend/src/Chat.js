import { useState, useRef } from "react";
import FileTree from "./FileTree";

function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingWrite, setPendingWrite] = useState(null);
  const [writeStatus, setWriteStatus] = useState("");
  const isSendingRef = useRef(false);

  const sendMessage = async () => {
    if (!input.trim() || isSendingRef.current) return;
    isSendingRef.current = true;
    setIsStreaming(true);
    setWriteStatus("");

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
        } else if (data.action === "write_rejected") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Write rejected: ${data.reason}` }
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

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: 16, fontFamily: "sans-serif" }}>
      <h2>Taifa AI</h2>
      <FileTree />

      <div style={{ minHeight: 300, border: "1px solid #ccc", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        {messages.length === 0 && !pendingWrite && (
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
      {writeStatus && (
        <div style={{ marginBottom: 16, color: "#555", fontSize: 14 }}>{writeStatus}</div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          autoCapitalize="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          placeholder="Ask something, or: write to: path.js | instruction"
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
