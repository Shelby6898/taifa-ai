import { useState, useRef } from "react";
import { authFetch } from "./authFetch";
import FileTree from "./FileTree";

function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingWrite, setPendingWrite] = useState(null);
  const [writeStatus, setWriteStatus] = useState("");
  const [pendingPlan, setPendingPlan] = useState(null);
  const [pendingDiffs, setPendingDiffs] = useState(null);
  const [pendingToolAction, setPendingToolAction] = useState(null);
  const [toolActionStatus, setToolActionStatus] = useState("");
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
      const response = await authFetch("http://localhost:5000/api/chat", {
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
        } else if (data.action === "clarification_question") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Question ${data.questionNumber} of ${data.totalQuestions}: ${data.question}` }
          ]);
        } else if (data.action === "architecture_context_check") {
          const fileList = data.relevantFiles.map((f) => `- ${f}`).join("\n");
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `${data.message}\n\n${fileList}` }
          ]);
        } else if (data.action === "requirements_summary") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `${data.message}\n\n${data.summary}` }
          ]);
        } else if (data.action === "architecture_blueprint") {
          const b = data.blueprint;
          const lines = [
            `Frontend: ${b.frontend}`,
            `Backend: ${b.backend}`,
            `Database: ${b.database}`,
            `Authentication: ${b.authentication}`,
            `Storage: ${b.storage}`,
            `Collections: ${(b.collections || []).join(", ")}`,
            `Modules: ${(b.modules || []).join(", ")}`,
            `Estimated files: ${b.estimatedFiles}`
          ].join("\n");
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `${data.message}\n\n${lines}` }
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
        } else if (data.action === "tests_ran") {
          const statusLine = data.passed ? "✅ Tests passed" : "❌ Tests failed";
          const timeoutNote = data.timedOut ? " (timed out)" : "";
          const output = [data.stdout, data.stderr].filter(Boolean).join("\n");
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `${statusLine}${timeoutNote} — ran in ${data.projectDir}\n\n${output}`
            }
          ]);
        } else if (data.action === "tests_not_found") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.message }
          ]);
        } else if (data.action === "git_status" || data.action === "git_diff") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.stdout + (data.stderr ? "\n" + data.stderr : "") }
          ]);
        } else if (data.action === "git_commit_refused") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `🚫 ${data.message}` }
          ]);
        } else if (data.action === "git_not_repo" || data.action === "git_nothing_to_commit") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.message }
          ]);
        } else if (data.action === "commit_proposed") {
          setPendingToolAction({ type: "commit", actionId: data.actionId, message: data.message, diffPreview: data.diffPreview });
        } else if (data.action === "install_proposed") {
          setPendingToolAction({ type: "install", actionId: data.actionId, packageName: data.packageName });
        } else if (data.action === "test_generation_refused") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `🚫 ${data.message}` }
          ]);
        } else if (data.action === "action_rejected") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Action rejected: ${data.reason}` }
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

  const handleKeyDown = () => {
    // On mobile there's no reliable Shift key, so Enter always inserts
    // a newline (default textarea behavior, nothing to intercept here)
    // and sending only happens via the Send button.
  };

  const approveWrite = async () => {
    if (!pendingWrite) return;
    setWriteStatus("Writing...");

    try {
      const response = await authFetch("http://localhost:5000/api/write", {
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
      const response = await authFetch("http://localhost:5000/api/plan/approve", {
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
      await authFetch("http://localhost:5000/api/plan/reject", {
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

  const approveToolAction = async () => {
    if (!pendingToolAction) return;
    setToolActionStatus("Running...");

    try {
      const response = await authFetch("http://localhost:5000/api/tool-action/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: pendingToolAction.actionId })
      });

      const result = await response.json();
      setPendingToolAction(null);

      const summary =
        result.action === "commit_applied" ? `✅ Committed:\n${result.stdout}` :
        result.action === "commit_failed" ? `❌ Commit failed: ${result.reason}` :
        result.action === "install_applied" ? `✅ Installed in ${result.projectDir}:\n${result.stdout}` :
        result.action === "install_failed" ? `❌ Install failed: ${result.reason}` :
        `Action result: ${JSON.stringify(result)}`;

      setMessages((prev) => [...prev, { role: "assistant", content: summary }]);
      setToolActionStatus("");
    } catch (err) {
      setToolActionStatus(`Action failed: ${err.message}`);
    }
  };

  const rejectToolAction = async () => {
    if (!pendingToolAction) return;

    try {
      await authFetch("http://localhost:5000/api/tool-action/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: pendingToolAction.actionId })
      });
    } catch (err) {
      console.error("Reject tool action failed:", err);
    } finally {
      setPendingToolAction(null);
      setMessages((prev) => [...prev, { role: "assistant", content: "Action rejected — nothing was run." }]);
    }
  };

  const applyPlan = async () => {
    if (!pendingDiffs) return;
    setPlanStatus("Applying all files...");

    try {
      const response = await authFetch("http://localhost:5000/api/plan/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: pendingDiffs.planId })
      });

      const result = await response.json();

      if (result.success) {
        const summary = result.filesWritten
          .map((f) => `${f.path} (${f.bytesWritten} bytes)`)
          .join(", ");

        if (result.nextBatch) {
          setPlanStatus(`Applied: ${summary} — next batch ready for review`);
          setPendingPlan(result.nextBatch);
        } else if (result.campaignComplete) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `All ${result.totalBatches} batches applied. Files written: ${summary}` }
          ]);
          setPlanStatus("");
        } else {
          setPlanStatus(`Applied: ${summary}`);
        }
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
      await authFetch("http://localhost:5000/api/plan/reject", {
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
    <div className="chat-shell">
      <div className="chat-header">
        <h2 className="chat-title">
          Taifa <span className="accent">AI</span>
        </h2>
        <FileTree />
      </div>

      <div className="chat-log">
        {messages.length === 0 && !pendingWrite && !pendingPlan && !pendingDiffs && (
          <p className="chat-empty">start a conversation...</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className="msg">
            <span className={`msg-role ${m.role === "user" ? "msg-role-user" : "msg-role-ai"}`}>
              {m.role === "user" ? "you" : "taifa"}
            </span>
            <span className="msg-content">{m.content}</span>
          </div>
        ))}
      </div>

      {pendingWrite && (
        <div className="panel panel-write">
          <p className="panel-title">
            {pendingWrite.mode === "edit" ? "proposed edit" : "proposed new file"}: {pendingWrite.targetPath}
          </p>
          {pendingWrite.locationMethod && (
            <p className={`panel-note ${pendingWrite.locationMethod === "stack_trace" ? "panel-note-ok" : "panel-note-warn"}`}>
              {pendingWrite.locationMethod === "stack_trace"
                ? "found via stack trace"
                : "best guess via keyword search — review carefully"}
            </p>
          )}
          {pendingWrite.isDocumentation && (
            <p className="panel-note panel-note-warn">
              ai-generated documentation — technical claims may be inaccurate. verify against the file content below before approving.
            </p>
          )}
          <div className="diff-pair">
            <div className="diff-block">
              <div className="diff-label">before</div>
              <pre className="diff-pre diff-before">{pendingWrite.before || "(new file — no previous content)"}</pre>
            </div>
            <div className="diff-block">
              <div className="diff-label">after</div>
              <pre className="diff-pre diff-after">{pendingWrite.after}</pre>
            </div>
          </div>
          <div className="panel-actions">
            <button onClick={approveWrite} className="btn-approve">approve</button>
            <button onClick={rejectWrite} className="btn-reject">reject</button>
          </div>
        </div>
      )}

      {pendingPlan && (
        <div className="panel panel-plan">
          <p className="panel-title">proposed plan: {pendingPlan.description}</p>
          {pendingPlan.truncated && (
            <p className="panel-note panel-note-danger">
              plan was truncated to 5 files. dropped: {pendingPlan.truncatedFiles?.join(", ")}
            </p>
          )}
          <div className="plan-files">
            {pendingPlan.files.map((f, i) => (
              <div key={i} className="plan-file">
                <div className="plan-file-path">{f.path}</div>
                <div className="plan-file-desc">{f.description}</div>
              </div>
            ))}
          </div>
          <p className="panel-hint">
            approving will generate code for each file above. you will review all diffs before anything is written to disk.
          </p>
          <div className="panel-actions">
            <button onClick={approvePlan} className="btn-approve">approve plan</button>
            <button onClick={rejectPlan} className="btn-reject">reject plan</button>
          </div>
        </div>
      )}

      {pendingToolAction && (
        <div className="panel panel-tool">
          {pendingToolAction.type === "commit" ? (
            <>
              <p className="panel-title">proposed commit: "{pendingToolAction.message}"</p>
              <pre className="diff-pre">{pendingToolAction.diffPreview}</pre>
            </>
          ) : (
            <p className="panel-title">about to run: npm install {pendingToolAction.packageName}</p>
          )}
          {toolActionStatus && <p className="panel-hint">{toolActionStatus}</p>}
          <div className="panel-actions">
            <button onClick={approveToolAction} className="btn-approve">approve</button>
            <button onClick={rejectToolAction} className="btn-reject">reject</button>
          </div>
        </div>
      )}

      {pendingDiffs && (
        <div className="panel panel-diffs">
          <p className="panel-title">
            review all diffs — {pendingDiffs.files.length} file{pendingDiffs.files.length > 1 ? "s" : ""}
          </p>
          {pendingDiffs.files.map((f, i) => (
            <div key={i} className="diff-file">
              <div className="diff-file-path">
                {f.mode === "edit" ? "edit" : "new"}: {f.path}
              </div>
              <div className="diff-pair">
                <div className="diff-block">
                  <div className="diff-label">before</div>
                  <pre className="diff-pre diff-before">{f.before || "(new file — no previous content)"}</pre>
                </div>
                <div className="diff-block">
                  <div className="diff-label">after</div>
                  <pre className="diff-pre diff-after">{f.after}</pre>
                </div>
              </div>
            </div>
          ))}
          <p className="panel-hint">this is all-or-nothing. approving writes all files; rejecting writes none.</p>
          <div className="panel-actions">
            <button onClick={applyPlan} className="btn-approve">apply all</button>
            <button onClick={rejectDiffs} className="btn-reject">reject all</button>
          </div>
        </div>
      )}

      {writeStatus && <div className="status-line">{writeStatus}</div>}
      {planStatus && <div className="status-line">{planStatus}</div>}

      <div className="composer">
        <textarea
          autoCapitalize="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          placeholder="ask something, or: plan: what to build (enter for new line, tap send to submit)"
          rows={1}
          className="composer-input"
        />
        <button onClick={sendMessage} disabled={isStreaming} className="composer-send">
          {isStreaming ? "thinking..." : "send"}
        </button>
      </div>
    </div>
  );
}

export default Chat;
