import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

// Proxies chat completions to Groq, keeping GROQ_API_KEY server-side.
export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GROQ_API_KEY not configured" },
      { status: 500, headers: CORS }
    );
  }

  try {
    const body = await req.json();
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status, headers: CORS });
  } catch (err) {
    return NextResponse.json(
      { error: "Proxy error", detail: (err as Error).message },
      { status: 500, headers: CORS }
    );
  }
}
