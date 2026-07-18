import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  const origin = host ? `${protocol}://${host}` : "https://my-voice-ai.openai.site";

  return {
    title: "My Voice AI — Speak once. Create forever.",
    description: "A privacy-first AI voice cloning studio for creators, built for OpenAI Build Week.",
    openGraph: {
      title: "My Voice AI",
      description: "Record once. Turn any script into your own AI narration.",
      images: [`${origin}/og.png`],
    },
    twitter: {
      card: "summary_large_image",
      title: "My Voice AI",
      description: "Record once. Turn any script into your own AI narration.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
