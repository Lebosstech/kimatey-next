import "./index.css";
import LegacyView from "@/components/LegacyView";
import html from "@/legacy/indexBody";
import { LEAFLET, FIREBASE_V8 } from "@/legacy/scripts";

// Home — citizen app (was index.html). Uses Firebase v8 (auth + database).
export default function Home() {
  return (
    <LegacyView
      html={html}
      scripts={[LEAFLET, ...FIREBASE_V8, "/legacy/index.js"]}
    />
  );
}
