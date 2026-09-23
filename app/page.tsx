import type { Metadata } from "next";
import Editor from "./Editor";

export const metadata: Metadata = {
  title: "Cutline — Free local video editor",
  description:
    "A fast, private, watermark-free video editor for your browser. No account, subscription, or upload required.",
};

export default function Home() {
  return <Editor />;
}
