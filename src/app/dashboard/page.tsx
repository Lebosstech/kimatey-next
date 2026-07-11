import "../dashboard.css";
import LegacyView from "@/components/LegacyView";
import html from "@/legacy/dashboardBody";
import { LEAFLET, FIREBASE_V10_COMPAT } from "@/legacy/scripts";

// Operator dashboard (was dashboard.html). Uses Firebase v10 compat.
export default function Dashboard() {
  return (
    <LegacyView
      html={html}
      scripts={[LEAFLET, ...FIREBASE_V10_COMPAT, "/legacy/dashboard.js"]}
    />
  );
}
