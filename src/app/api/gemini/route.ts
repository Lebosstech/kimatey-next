import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface GeminiRequest {
  message?: string;
  context?: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

// Proxies the Kimi assistant prompt to Gemini, keeping GEMINI_API_KEY server-side.
export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured" },
      { status: 500, headers: CORS }
    );
  }

  try {
    const { message, context } = (await req.json()) as GeminiRequest;
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Tu es Kimi, assistant IA de Kimatey Flow Navigator à Abidjan (Terra Flow Africa · Kimatey Enterprise).
Contexte réseau KCM: ${context || "5 nœuds actifs, trafic modéré"}.
Tu réponds en français ivoirien, concis (max 2 phrases), utile et bienveillant.
Tu peux répondre en Dioula, Baoulé ou Bété si l'utilisateur le demande.
Question: ${message}`,
                },
              ],
            },
          ],
          generationConfig: { maxOutputTokens: 200, temperature: 0.7 },
        }),
      }
    );

    const data = (await r.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return NextResponse.json({ text }, { status: 200, headers: CORS });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500, headers: CORS }
    );
  }
}
