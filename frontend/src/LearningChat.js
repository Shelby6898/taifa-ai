import { useEffect, useRef, useState } from "react";
import { authFetch } from "./authFetch";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./LearningChat.css";

const API = "http://localhost:5000/api/learning";

function LearningChat() {
  const [conversations, setConversations] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [creating, setCreating] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState("");
  const sendingRef = useRef(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;

    async function loadConversations() {
      try {
        const response = await authFetch(`${API}/conversations`);
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not load learning chats.");
        }

        if (cancelled) return;
        setConversations(data.conversations || []);

        if (data.conversations?.length) {
          await loadMessages(data.conversations[0].id, cancelled);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadConversations();
    return () => { cancelled = true; };
  }, []);

  async function loadMessages(id, cancelled = false) {
    setLoadingMessages(true);
    setError("");

    try {
      const response = await authFetch(
        `${API}/conversations/${id}/messages`
      );
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not load this conversation.");
      }

      if (cancelled) return;
      setCurrentId(id);
      setMessages(data.messages || []);
    } catch (err) {
      if (!cancelled) setError(err.message);
    } finally {
      if (!cancelled) setLoadingMessages(false);
    }
  }

  async function createConversation() {
    if (creating || isStreaming) return;

    setCreating(true);
    setError("");

    try {
      const response = await authFetch(`${API}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not create a learning chat.");
      }

      const conversation = data.conversation;
      setConversations((previous) => [conversation, ...previous]);
      setCurrentId(conversation.id);
      setMessages([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function sendMessage(event) {
    event?.preventDefault();

    const prompt = input.trim();
    if (!prompt || !currentId || sendingRef.current) return;

    sendingRef.current = true;
    setIsStreaming(true);
    setError("");
    setInput("");

    setMessages((previous) => [
      ...previous,
      { role: "user", content: prompt },
      { role: "assistant", content: "" }
    ]);

    try {
      const response = await authFetch(
        `${API}/conversations/${currentId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt })
        }
      );

      const contentType = response.headers.get("Content-Type") || "";

      if (!response.ok || contentType.includes("application/json")) {
        const data = await response.json();
        throw new Error(data.error || "The tutor could not respond.");
      }

      if (!response.body) {
        throw new Error("Streaming is not supported by this connection.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      function handleEvent(part) {
        const line = part.split("\n").find((item) => item.startsWith("data:"));
        if (!line) return;

        const raw = line.slice(5).trim();
        if (!raw) return;

        const data = JSON.parse(raw);

        if (data.token) {
          setMessages((previous) => {
            const updated = [...previous];
            const last = updated.length - 1;
            if (last >= 0 && updated[last].role === "assistant") {
              updated[last] = {
                ...updated[last],
                content: updated[last].content + data.token
              };
            }
            return updated;
          });
        }

        if (data.error) setError(data.error);
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) handleEvent(part);
      }

      buffer += decoder.decode();
      if (buffer.trim()) handleEvent(buffer);

      const listResponse = await authFetch(`${API}/conversations`);
      const listData = await listResponse.json();
      if (listResponse.ok && listData.success) {
        setConversations(listData.conversations || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      sendingRef.current = false;
      setIsStreaming(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage(event);
    }
  }

  return (
    <div className="learning-layout">
      <aside className="learning-sidebar">
        <div className="learning-sidebar-heading">
          <span>YOUR LEARNING</span>
          <button
            className="learning-new-btn"
            onClick={createConversation}
            disabled={creating || isStreaming}
          >
            {creating ? "Creating..." : "+ New Chat"}
          </button>
        </div>

        <div className="learning-conversation-list">
          {loading ? (
            <p className="learning-muted">Loading conversations...</p>
          ) : conversations.length === 0 ? (
            <p className="learning-muted">No learning chats yet.</p>
          ) : (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={
                  Number(currentId) === Number(conversation.id)
                    ? "learning-conversation active"
                    : "learning-conversation"
                }
                onClick={() => loadMessages(conversation.id)}
                disabled={isStreaming}
              >
                <span className="learning-conversation-title">
                  {conversation.title}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="learning-main">
        <header className="learning-header">
          <div>
            <p className="learning-eyebrow">TAIFA AI / INDEPENDENT SPACE</p>
            <h2>Learning <span className="accent">Chat</span></h2>
            <p className="learning-subtitle">
              Explore concepts, ask questions, and build your understanding.
            </p>
          </div>
        </header>

        {error && <div className="learning-error">{error}</div>}

        <section className="learning-messages">
          {loadingMessages ? (
            <p className="learning-muted">Loading conversation...</p>
          ) : messages.length === 0 ? (
            <div className="learning-welcome">
              <span className="learning-welcome-mark">T.</span>
              <h3>What would you like to learn?</h3>
              <p>
                Ask about software engineering, programming, databases,
                system design, or any topic you want to understand.
              </p>
              {!currentId && (
                <button onClick={createConversation} disabled={creating}>
                  {creating ? "Creating..." : "Start a learning conversation"}
                </button>
              )}
            </div>
          ) : (
            messages.map((message, index) => (
              <article className={`learning-message ${message.role}`} key={message.id || index}>
                <span className="learning-message-role">
                  {message.role === "user" ? "YOU" : "TAIFA TUTOR"}
                </span>
                <div className="learning-message-content">
                  {message.role === "assistant" ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content || (isStreaming && index === messages.length - 1
                        ? "Thinking..."
                        : "")}
                    </ReactMarkdown>
                  ) : (
                    message.content
                  )}
                  {isStreaming && index === messages.length - 1 && message.role === "assistant" && (
                    <span className="cursor-blink" />
                  )}
                </div>
              </article>
            ))
          )}
          <div ref={bottomRef} />
        </section>

        <form className="learning-composer" onSubmit={sendMessage}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question or explore a concept..."
            rows={2}
            disabled={!currentId || isStreaming}
          />
          <div className="learning-composer-footer">
            <span>ENTER to send · SHIFT + ENTER for a new line</span>
            <button
              type="submit"
              disabled={!currentId || !input.trim() || isStreaming}
            >
              {isStreaming ? "Teaching..." : "Send message"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

export default LearningChat;
