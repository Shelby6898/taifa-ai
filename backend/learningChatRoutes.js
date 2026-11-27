const express = require("express");
const axios = require("axios");
const { pool } = require("./db");
const { requireAuth } = require("./authMiddleware");

const router = express.Router();

const OLLAMA_URL = "http://127.0.0.1:11434";
const MODEL_NAME = "qwen2.5-coder-6k";

router.use(requireAuth);

async function ownsConversation(conversationId, studentId) {
  const { rows } = await pool.query(
    "SELECT id, title FROM learning_conversations WHERE id = $1 AND student_id = $2",
    [conversationId, studentId]
  );
  return rows[0] || null;
}

// List this student's learning conversations.
router.get("/conversations", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, created_at, updated_at
       FROM learning_conversations
       WHERE student_id = $1
       ORDER BY updated_at DESC, id DESC`,
      [req.userId]
    );
    res.json({ success: true, conversations: rows });
  } catch (err) {
    console.error("[learning] List failed:", err.message);
    res.status(500).json({ success: false, error: "Could not load learning conversations." });
  }
});

// Start a separate learning conversation.
router.post("/conversations", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO learning_conversations (student_id)
       VALUES ($1)
       RETURNING id, title, created_at, updated_at`,
      [req.userId]
    );
    res.status(201).json({ success: true, conversation: rows[0] });
  } catch (err) {
    console.error("[learning] Create failed:", err.message);
    res.status(500).json({ success: false, error: "Could not create a learning conversation." });
  }
});

// Load messages from one of this student's learning conversations.
router.get("/conversations/:id/messages", async (req, res) => {
  try {
    const conversation = await ownsConversation(req.params.id, req.userId);
    if (!conversation) {
      return res.status(404).json({ success: false, error: "Learning conversation not found." });
    }

    const { rows } = await pool.query(
      `SELECT id, role, content, created_at
       FROM learning_messages
       WHERE conversation_id = $1
       ORDER BY created_at, id`,
      [conversation.id]
    );

    res.json({ success: true, messages: rows });
  } catch (err) {
    console.error("[learning] History failed:", err.message);
    res.status(500).json({ success: false, error: "Could not load learning messages." });
  }
});

// Stream a teaching-focused answer. This route has no project tools.
router.post("/conversations/:id/messages", async (req, res) => {
  const prompt = typeof req.body.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) {
    return res.status(400).json({ success: false, error: "A message is required." });
  }
  if (prompt.length > 12000) {
    return res.status(400).json({ success: false, error: "Message is too long." });
  }

  try {
    const conversation = await ownsConversation(req.params.id, req.userId);
    if (!conversation) {
      return res.status(404).json({ success: false, error: "Learning conversation not found." });
    }

    await pool.query(
      "INSERT INTO learning_messages (conversation_id, role, content) VALUES ($1, 'user', $2)",
      [conversation.id, prompt]
    );

    const title = conversation.title === "New learning chat"
      ? prompt.replace(/\s+/g, " ").slice(0, 60)
      : conversation.title;

    await pool.query(
      "UPDATE learning_conversations SET title = $1, updated_at = now() WHERE id = $2",
      [title || "New learning chat", conversation.id]
    );

    const { rows } = await pool.query(
      `SELECT role, content FROM learning_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 21`,
      [conversation.id]
    );

    const history = rows.reverse();
    const conversationText = history.map((item) =>
      `${item.role === "user" ? "Student" : "Tutor"}: ${item.content}`
    ).join("\n\n");

    const fullPrompt = [
      "You are Taifa AI Learning Tutor.",
      "Teach clearly and patiently. Explain concepts step by step.",
      "Use practical examples, especially software development examples when relevant.",
      "Ask a brief follow-up question when it would help the student learn.",
      "This is an independent learning conversation.",
      "Do not claim to inspect, modify, or remember project files.",
      "Do not execute commands or propose project actions as if they were performed.",
      "Conversation:",
      conversationText,
      "Tutor:"
    ].join("\n\n");

    const response = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      { model: MODEL_NAME, prompt: fullPrompt, stream: true },
      { responseType: "stream", timeout: 0 }
    );

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let buffer = "";
    let answer = "";

    for await (const chunk of response.data) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);

        if (parsed.response) {
          answer += parsed.response;
          res.write(`data: ${JSON.stringify({ token: parsed.response })}\n\n`);
        }
      }
    }

    if (buffer.trim()) {
      const parsed = JSON.parse(buffer);
      if (parsed.response) {
        answer += parsed.response;
        res.write(`data: ${JSON.stringify({ token: parsed.response })}\n\n`);
      }
    }

    if (answer.trim()) {
      await pool.query(
        "INSERT INTO learning_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)",
        [conversation.id, answer]
      );
    }

    await pool.query(
      "UPDATE learning_conversations SET updated_at = now() WHERE id = $1",
      [conversation.id]
    );

    if (!res.destroyed) {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
  } catch (err) {
    console.error("[learning] Chat failed:", err.message);

    if (res.headersSent) {
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ error: "Learning response failed." })}\n\n`);
        res.end();
      }
    } else {
      res.status(500).json({ success: false, error: "Learning response failed." });
    }
  }
});

module.exports = router;
