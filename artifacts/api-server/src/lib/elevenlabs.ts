const STT_KEY = process.env["STT_ELEVENLLABS_API_KEY"]!;
const TTS_KEY = process.env["TTS_ELEVENLLABS_API_KEY"]!;

// Baire's voice — Rachel (warm, professional, natural)
const BAIRE_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export async function elevenLabsSpeechToText(
  audioBuffer: Buffer,
  mimeType: string = "audio/webm"
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: mimeType }), "audio.webm");
  form.append("model_id", "scribe_v1");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": STT_KEY },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs STT ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { text: string };
  return data.text.trim();
}

export async function elevenLabsTextToSpeechBuffer(text: string): Promise<Buffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${BAIRE_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": TTS_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.48,
          similarity_boost: 0.78,
          style: 0.08,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ElevenLabs TTS ${res.status}: ${t}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function* elevenLabsTextToSpeechStream(
  text: string
): AsyncGenerator<Buffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${BAIRE_VOICE_ID}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": TTS_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.48,
          similarity_boost: 0.78,
          style: 0.08,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!res.ok || !res.body) {
    const t = await res.text();
    throw new Error(`ElevenLabs TTS stream ${res.status}: ${t}`);
  }

  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield Buffer.from(value);
  }
}
