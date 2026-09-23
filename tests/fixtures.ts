import { clipDuration, makeClip, makeText, newProject, type Asset } from "../app/editor/model";

// Historical samples remain test fixtures only; they are never seeded in the app.
export const SAMPLE_ASSETS: Asset[] = [
  { id: "demo-aurora", name: "Aurora ridge", kind: "demo", duration: 4.8, theme: "aurora", sizeLabel: "Demo · 4.8s" },
  { id: "demo-alpine", name: "Alpine morning", kind: "demo", duration: 4.2, theme: "alpine", sizeLabel: "Demo · 4.2s" },
  { id: "demo-city", name: "City after rain", kind: "demo", duration: 5.6, theme: "city", sizeLabel: "Demo · 5.6s" },
];

export function sampleProject() {
  const p = newProject();
  p.name = "Weekend escape";
  p.assets = SAMPLE_ASSETS.map((a) => ({ ...a }));
  let cursor = 0;
  p.clips = p.assets.map((a, i) => {
    const c = makeClip(a, cursor, 1);
    c.id = `clip-${a.theme}`;
    c.transition = i ? "Dissolve" : "None";
    cursor += clipDuration(c);
    return c;
  });
  p.texts = [makeText(0.35, {
    id: "text-intro", track: 2, text: "GO SOMEWHERE NEW", fontSize: 86,
    y: 0.76, duration: 4, animation: "Rise",
  })];
  return p;
}
