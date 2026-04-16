import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { runBaireAgent, runBaireAgentStream, UserContext } from "../agents/baire-agent.js";
import {
  elevenLabsSpeechToText,
  elevenLabsTextToSpeechStream,
} from "../lib/elevenlabs.js";
import {
  textToSpeech as openaiTTS,
  speechToText as openaiSTT,
  ensureCompatibleFormat,
} from "@workspace/integrations-openai-ai-server/audio";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function sseHeaders(res: any) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
}

function sendEvent(res: any, data: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function getConversationHistory(conversationId: number) {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .limit(20);

  return rows.map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
  }));
}

router.post("/baire/conversations", async (req, res) => {
  try {
    const title = (req.body as any).title ?? "Baire Conversation";
    const [conv] = await db.insert(conversations).values({ title }).returning();
    res.json({ id: conv!.id, title: conv!.title, createdAt: conv!.createdAt });
  } catch (err) {
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.get("/baire/conversations/:id/messages", async (req, res) => {
  try {
    const id = parseInt(req.params["id"]!, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid conversation ID" });

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.post("/baire/conversations/:id/messages", async (req, res) => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid conversation ID" });

  const body = req.body as any;
  const userText = body.message as string | undefined;
  if (!userText?.trim()) return res.status(400).json({ error: "message is required" });

  const userContext: UserContext | undefined = (body.user_name || body.user_email)
    ? {
        name: body.user_name,
        email: body.user_email,
        walletAddress: body.wallet_address,
        walletBalanceUsdc: typeof body.wallet_balance_usdc === "number" ? body.wallet_balance_usdc : undefined,
      }
    : undefined;

  sseHeaders(res);

  try {
    const history = await getConversationHistory(id);
    sendEvent(res, { type: "user_text", content: userText });

    let fullResponse = "";

    for await (const chunk of runBaireAgentStream(userText, history, userContext)) {
      fullResponse += chunk;
      sendEvent(res, { type: "text", content: chunk });
    }

    await db.insert(messages).values([
      { conversationId: id, role: "user", content: userText },
      { conversationId: id, role: "assistant", content: fullResponse },
    ]);

    sendEvent(res, { type: "done", full_response: fullResponse });
    res.end();
  } catch (err: any) {
    sendEvent(res, { type: "error", message: err?.message ?? "Agent error" });
    res.end();
  }
});

router.post(
  "/baire/conversations/:id/voice-messages",
  upload.single("audio"),
  async (req, res) => {
    const id = parseInt(req.params["id"]!, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid conversation ID" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "audio file is required (multipart field: audio)" });

    sseHeaders(res);

    try {
      sendEvent(res, { type: "status", message: "Transcribing your voice..." });

      let userTranscript: string;
      try {
        userTranscript = await elevenLabsSpeechToText(file.buffer, file.mimetype || "audio/webm");
      } catch {
        // ElevenLabs STT failed — fall back to OpenAI transcription
        try {
          const { buffer: wavBuffer, format } = await ensureCompatibleFormat(file.buffer);
          userTranscript = await openaiSTT(wavBuffer, format);
        } catch (sttErr: any) {
          sendEvent(res, {
            type: "agent_text",
            content: "Voice transcription is temporarily unavailable. Please tap the keyboard icon to type your message instead.",
          });
          sendEvent(res, { type: "done" });
          res.end();
          return;
        }
      }

      sendEvent(res, { type: "user_transcript", content: userTranscript });
      sendEvent(res, { type: "status", message: "Baire is thinking..." });

      const history = await getConversationHistory(id);
      const agentResponse = await runBaireAgent(userTranscript, history);

      await db.insert(messages).values([
        { conversationId: id, role: "user", content: userTranscript },
        { conversationId: id, role: "assistant", content: agentResponse },
      ]);

      sendEvent(res, { type: "agent_text", content: agentResponse });
      sendEvent(res, { type: "done" });
      res.end();
    } catch (err: any) {
      sendEvent(res, { type: "error", message: err?.message ?? "Voice processing error" });
      res.end();
    }
  }
);

router.post("/baire/voice-quick", upload.single("audio"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "audio file required" });

  sseHeaders(res);

  try {
    sendEvent(res, { type: "status", message: "Transcribing..." });

    const userTranscript = await elevenLabsSpeechToText(file.buffer, file.mimetype || "audio/webm");

    sendEvent(res, { type: "user_transcript", content: userTranscript });
    sendEvent(res, { type: "status", message: "Baire is thinking..." });

    const agentResponse = await runBaireAgent(userTranscript);

    sendEvent(res, { type: "agent_text", content: agentResponse });
    sendEvent(res, { type: "done" });
    res.end();
  } catch (err: any) {
    sendEvent(res, { type: "error", message: err?.message ?? "Error" });
    res.end();
  }
});

router.post("/baire/tts", async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) return res.status(400).json({ error: "text is required" });

  // Try ElevenLabs first; fall back to OpenAI if plan doesn't support it
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of elevenLabsTextToSpeechStream(text)) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    res.send(audioBuffer);
    return;
  } catch {
    // ElevenLabs failed — fall through to OpenAI
  }

  try {
    const audioBuffer = await openaiTTS(text, "nova", "mp3");
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    res.send(audioBuffer);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "TTS failed" });
  }
});

export default router;
