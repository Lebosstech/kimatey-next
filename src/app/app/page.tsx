import "../app.css";
import LegacyView from "@/components/LegacyView";
import html from "@/legacy/appBody";
import { LEAFLET, FIREBASE_V8 } from "@/legacy/scripts";

// Legacy alternate app view (was app.html — not routed in the original
// vercel.json). Exposed here at /app for completeness. Uses Firebase v8.
export default function AppLegacy() {
  return (
    <LegacyView
      html={html}
      scripts={[LEAFLET, ...FIREBASE_V8, "/legacy/app.js"]}
    />
  );
}
