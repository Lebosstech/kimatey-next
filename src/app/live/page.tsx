import "../live.css";
import LegacyView from "@/components/LegacyView";
import html from "@/legacy/liveBody";
import { LEAFLET, FIREBASE_V10_COMPAT } from "@/legacy/scripts";

// Live network view (was live.html). Uses Firebase v10 compat.
export default function Live() {
  return (
    <LegacyView
      html={html}
      scripts={[LEAFLET, ...FIREBASE_V10_COMPAT, "/legacy/live.js"]}
    />
  );
}
