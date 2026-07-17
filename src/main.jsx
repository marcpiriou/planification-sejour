import "./storage-shim.js"; // en premier : installe window.storage avant escale.jsx
import { createRoot } from "react-dom/client";
import Root from "./escale.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(<Root />);
