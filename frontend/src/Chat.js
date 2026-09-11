import { useState, useRef, useEffect } from "react";
import { authFetch } from "./authFetch";
import FileTree from "./FileTree";

function Chat({ currentProject }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingWrite, setPendingWrite] = useState(null);
  const [writeStatus, setWriteStatus] = useState("");
  const [pendingPlan, setPendingPlan] = useState(null);
  const [pendingBlueprint, setPendingBlueprint] = useState(null);
  const [pendingDiffs, setPendingDiffs] = useState(null);
  const [pendingToolAction, setPendingToolAction] = useState(null);
  const [toolActionStatus, setToolActionStatus] = useState("");
  const [planStatus, setPlanStatus] = useState("");
  const isSendingRef = useRef(false);

  useEffect(() => {
    if (!currentProject) return;

    // Reset all per-project UI state unconditionally before restoring —
    // otherwise switching to a project with no history/pending state
    // leaves the PREVIOUS project's messages/pending panels on screen,
    // since the restore logic below only ever conditionally SETS state,
    // never clears it when the new project has nothing to restore.
    setMessages([]);
    setPendingWrite(null);
    setPendingPlan(null);
    setPendingBlueprint(null);
    setPendingDiffs(null);
    setPendingToolAction(null);
    setWriteStatus("");
    setToolActionStatus("");
    setPlanStatus("");

    const restoreSession = async () => {
      try {
        const historyUrl = `http://localhost:5000/api/chat/history?projectName=${encodeURIComponent(currentProject)}`;
        const historyResponse = await authFetch(historyUrl);
        const historyData = await historyResponse.json();

        if (historyData.success && historyData.history.length > 0) {
          const skipActions = new Set(["propose_write", "plan_proposed", "architecture_blueprint", "commit_proposed", "install_proposed"]);
          const restored = historyData.history
            .filter((turn) => turn.role === "user" || !skipActions.has(turn.action))
            .map((turn) => ({
              role: turn.role,
              content: turn.role === "user" ? turn.content : turn.action === "chat_reply" ? turn.content : formatAssistantMessage({ ...turn.data, action: turn.action })
            }));
          setMessages(restored);
        }
      } catch (err) {
        console.error("Failed to load conversation history:", err);
      }

      try {
        const url = `http://localhost:5000/api/session/current?projectName=${encodeURIComponent(currentProject)}`;
        const response = await authFetch(url);
        const data = await response.json();
        if (!data.success || !data.pending) return;

        if (data.pending === "toolAction") {
          setPendingToolAction(data.data);
        } else if (data.pending === "plan") {
          setPendingPlan(data.data);
        } else if (data.pending === "diffs") {
          setPendingDiffs(data.data);
        } else if (data.pending === "write") {
          setPendingWrite(data.data);
        } else if (data.pending === "architectureBlueprint") {
          setPendingBlueprint(data.data);
        }
        // clarificationQuestion/requirementsSummary/architectureContextCheck no
        // longer need special-case reconstruction here — they're already part
        // of the real history loaded above, since every /api/chat response is
        // now persisted server-side.
      } catch (err) {
        console.error("Failed to recover session state:", err);
      }
    };

    restoreSession();
  }, [currentProject]);


  // Turns a backend response payload into the plain-text content shown in
  // the chat log. Used both live (right after a response arrives) and when
  // restoring stored history on load, so there's exactly one place that
  // decides what a message looks like — never two copies to keep in sync.
  const formatAssistantMessage = (data) => {
    if (data.action === "chat_reply") {
      return data.content;
    } else if (data.action === "write_rejected") {
      return `Write rejected: ${data.reason}`;
    } else if (data.action === "plan_rejected") {
      return `Plan rejected: ${data.reason}`;
    } else if (data.action === "clarification_question") {
      return `Question ${data.questionNumber} of ${data.totalQuestions}: ${data.question}`;
    } else if (data.action === "architecture_context_check") {
      const fileList = data.relevantFiles.map((f) => `- ${f}`).join("\n");
      return `${data.message}\n\n${fileList}`;
    } else if (data.action === "requirements_summary") {
      return `${data.message}\n\n${data.summary}`;
    } else if (data.action === "fact_remembered") {
      return data.alreadyKnown
        ? `Already remembered: "${data.fact}"`
        : `Got it, I'll remember: "${data.fact}" (${data.totalFacts} facts stored)`;
    } else if (data.action === "remember_rejected") {
      return `Couldn't remember that: ${data.reason}`;
    } else if (data.action === "tests_ran") {
      const statusLine = data.passed ? "✅ Tests passed" : "❌ Tests failed";
      const timeoutNote = data.timedOut ? " (timed out)" : "";
      const output = [data.stdout, data.stderr].filter(Boolean).join("\n");
      return `${statusLine}${timeoutNote} — ran in ${data.projectDir}\n\n${output}`;
    } else if (data.action === "tests_not_found") {
      return data.message;
    } else if (data.action === "git_status" || data.action === "git_diff") {
      return data.stdout + (data.stderr ? "\n" + data.stderr : "");
    } else if (data.action === "git_commit_refused") {
      return `🚫 ${data.message}`;
    } else if (data.action === "git_not_repo" || data.action === "git_nothing_to_commit") {
      return data.message;
    } else if (data.action === "test_generation_refused") {
      return `🚫 ${data.message}`;
    } else if (data.action === "generation_refused") {
      const detailLines = [`🚫 ${data.reason}`];
      if (data.regressionWarnings && data.regressionWarnings.length > 0) {
        detailLines.push("", "Possible regressions:");
        data.regressionWarnings.forEach((w) => detailLines.push(`- ${w}`));
      }
      if (data.undeclaredDependencies && data.undeclaredDependencies.length > 0) {
        detailLines.push("", "Undeclared dependencies:");
        data.undeclaredDependencies.forEach((d) => detailLines.push(`- ${d}`));
      }
      if (data.packageVersionCheck && data.packageVersionCheck.invalidVersions && data.packageVersionCheck.invalidVersions.length > 0) {
        detailLines.push("", "Invalid package versions:");
        data.packageVersionCheck.invalidVersions.forEach((v) =>
          detailLines.push(`- ${v.name}@${v.exactVersion} does not exist on the npm registry`)
        );
      }
      if (data.testCheck && data.testCheck.hasTests && !data.testCheck.passed) {
        detailLines.push("", "Test output:", data.testCheck.output || "(no output captured)");
      }
      return detailLines.join("\n");
    } else if (data.action === "action_rejected") {
      return `Action rejected: ${data.reason}`;
    } else if (data.action === "generation_skipped") {
      return `ℹ️ ${data.reason}`;
    }
    return `Error: ${data.reason || data.error || "Unknown error"}`;
  };
  const sendMessage = async (promptOverride) => {
    const content = typeof promptOverride === "string" ? promptOverride : input;
    if (!content.trim() || isSendingRef.current) return;
    isSendingRef.current = true;
    setIsStreaming(true);
    setWriteStatus("");
    setPlanStatus("");

    const userMsg = { role: "user", content };
    setMessages((prev) => [...prev, userMsg]);
    if (typeof promptOverride !== "string") setInput("");

    try {
      const response = await authFetch("http://localhost:5000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: content, history: messages, projectName: currentProject })
      });

      const contentType = response.headers.get("Content-Type") || "";

      if (contentType.includes("application/json")) {
        const data = await response.json();

        if (data.action === "propose_write") {
          setPendingWrite(data);
        } else if (data.action === "plan_proposed") {
          setPendingPlan(data);
        } else if (data.action === "architecture_blueprint") {
          setPendingBlueprint(data);
        } else if (data.action === "commit_proposed") {
          setPendingToolAction({ type: "commit", actionId: data.actionId, message: data.message, diffPreview: data.diffPreview });
        } else if (data.action === "install_proposed") {
          setPendingToolAction({ type: "install", actionId: data.actionId, packageName: data.packageName });
        } else {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: formatAssistantMessage(data) }
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
          content: pendingWrite.after,
          projectName: currentProject
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

  const rejectWrite = async () => {
    setPendingWrite(null);
    setWriteStatus("Write discarded — nothing was saved.");
    try {
      await authFetch("http://localhost:5000/api/write/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName: currentProject })
      });
    } catch (err) {
      console.error("Failed to clear pending write:", err);
    }
  };

  const approvePlan = async () => {
    if (!pendingPlan) return;
    setPlanStatus("Generating diffs for each file...");

    try {
      const response = await authFetch("http://localhost:5000/api/plan/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: pendingPlan.planId, projectName: currentProject })
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
        body: JSON.stringify({ planId: pendingPlan.planId, projectName: currentProject })
      });
    } catch (err) {
      console.error("Reject plan failed:", err);
    } finally {
      setPendingPlan(null);
      setPlanStatus("Plan rejected — nothing was written.");
    }
  };

  const approveBlueprint = () => {
    if (!pendingBlueprint) return;
    setPendingBlueprint(null);
    sendMessage("looks good");
  };

  const approveToolAction = async () => {
    if (!pendingToolAction) return;
    setToolActionStatus("Running...");

    try {
      const response = await authFetch("http://localhost:5000/api/tool-action/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: pendingToolAction.actionId, projectName: currentProject })
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
        body: JSON.stringify({ actionId: pendingToolAction.actionId, projectName: currentProject })
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
        body: JSON.stringify({ planId: pendingDiffs.planId, projectName: currentProject })
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
        body: JSON.stringify({ planId: pendingDiffs.planId, projectName: currentProject })
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
        <FileTree currentProject={currentProject} />
      </div>

      <div className="chat-log">
        {messages.length === 0 && !pendingWrite && !pendingBlueprint && !pendingPlan && !pendingDiffs && (
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
          {pendingWrite.testCheck && pendingWrite.testCheck.hasTests && (
            <p className={`panel-note ${pendingWrite.testCheck.passed ? "panel-note-ok" : "panel-note-warn"}`}>
              {pendingWrite.testCheck.passed
                ? "✅ existing tests pass against this change"
                : "⚠️ existing tests fail against this change — review before approving"}
            </p>
          )}
          {pendingWrite.testCheck && !pendingWrite.testCheck.hasTests && (
            <p className="panel-note panel-note-warn">
              ⚠️ no test file found for this source file — this change was not mechanically verified
            </p>
          )}
          {Array.isArray(pendingWrite.lintCheck) && pendingWrite.lintCheck.length > 0 && (
            <div className="panel-note panel-note-warn">
              <p>lint check found {pendingWrite.lintCheck.length} issue(s):</p>
              <ul className="plan-validation-issues">
                {pendingWrite.lintCheck.map((issue, i) => (
                  <li key={i}>
                    {issue.rule ? <code>{issue.rule}</code> : null}{issue.line ? ` (line ${issue.line})` : ""}: {issue.message}
                  </li>
                ))}
              </ul>
            </div>
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

      {pendingBlueprint && (
        <div className="panel panel-blueprint">
          <p className="panel-title">proposed architecture</p>
          <div className="blueprint-fields">
            <div className="blueprint-field"><span className="blueprint-field-label">frontend</span><span className="blueprint-field-value">{pendingBlueprint.blueprint.frontend}</span></div>
            <div className="blueprint-field"><span className="blueprint-field-label">backend</span><span className="blueprint-field-value">{pendingBlueprint.blueprint.backend}</span></div>
            <div className="blueprint-field"><span className="blueprint-field-label">database</span><span className="blueprint-field-value">{pendingBlueprint.blueprint.database}</span></div>
            <div className="blueprint-field"><span className="blueprint-field-label">authentication</span><span className="blueprint-field-value">{pendingBlueprint.blueprint.authentication}</span></div>
            <div className="blueprint-field"><span className="blueprint-field-label">storage</span><span className="blueprint-field-value">{pendingBlueprint.blueprint.storage}</span></div>
            <div className="blueprint-field"><span className="blueprint-field-label">collections</span><span className="blueprint-field-value">{(pendingBlueprint.blueprint.collections || []).join(", ")}</span></div>
            <div className="blueprint-field"><span className="blueprint-field-label">modules</span><span className="blueprint-field-value">{(pendingBlueprint.blueprint.modules || []).join(", ")}</span></div>
            <div className="blueprint-field"><span className="blueprint-field-label">estimated files</span><span className="blueprint-field-value">{pendingBlueprint.blueprint.estimatedFiles}</span></div>
          </div>
          <p className="panel-hint">{pendingBlueprint.message}</p>
          <div className="panel-actions">
            <button onClick={approveBlueprint} className="btn-approve">looks good</button>
          </div>
        </div>
      )}

      {pendingPlan && (
        <div className="panel panel-plan">
          <p className="panel-title">proposed plan: {pendingPlan.description}</p>
          {typeof pendingPlan.estimatedFiles === "number" && (
            <p className="panel-note">
              {pendingPlan.incomplete
                ? `plan is still in progress — more batches will follow this one (estimated ${pendingPlan.estimatedFiles} files total)`
                : `plan complete (estimated ${pendingPlan.estimatedFiles} files)`}
            </p>
          )}
          {Array.isArray(pendingPlan.validationIssues) && pendingPlan.validationIssues.length > 0 && (
            <div className="panel-note panel-note-danger">
              <p>validator found {pendingPlan.validationIssues.length} issue(s) that could not be auto-fixed:</p>
              <ul className="plan-validation-issues">
                {pendingPlan.validationIssues.map((issue, i) => (
                  <li key={i}>
                    {issue.path ? <code>{issue.path}</code> : null} {issue.detail}
                  </li>
                ))}
              </ul>
            </div>
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
          {Array.isArray(pendingDiffs.codeValidationIssues) && pendingDiffs.codeValidationIssues.length > 0 && (
            <div className="panel-note panel-note-danger">
              <p>code validator found {pendingDiffs.codeValidationIssues.length} issue(s) in the generated code:</p>
              <ul className="plan-validation-issues">
                {pendingDiffs.codeValidationIssues.map((issue, i) => (
                  <li key={i}>
                    {issue.path ? <code>{issue.path}</code> : null} {issue.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
