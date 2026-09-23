import { createRoot } from "react-dom/client";
import Editor from "../app/Editor";
import "../app/globals.css";

document.documentElement.classList.add("desktop-runtime");

const root = document.getElementById("root");
if (!root) throw new Error("Cutline could not create its desktop window.");

createRoot(root).render(<Editor />);
