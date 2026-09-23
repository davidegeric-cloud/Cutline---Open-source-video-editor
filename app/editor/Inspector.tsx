import { useEffect, useState, type ReactNode } from "react";
import {
  SlidersHorizontal,
  RotateCcw,
  Diamond,
  X,
  AlignLeft,
  AlignCenter,
  AlignRight,
  FlipHorizontal2,
  FlipVertical2,
  ChevronDown,
  Type,
  Film,
  Music2,
  Play,
  Save,
  Trash2,
} from "lucide-react";
import { ANIMATIONS, FONTS, TRANSITIONS } from "./presets";
import { animationLayers, defaultAnimationSettings, textAnimationTiming } from "./textAnimation";
import {
  createCustomAnimationPreset,
  readCustomAnimationPresets,
  writeCustomAnimationPresets,
  type CustomAnimationPreset,
} from "./customAnimationPresets";
import {
  clamp,
  animatedItem,
  clipDuration,
  clock,
  interpolatedTransform,
  setPropertyKeyframe,
  togglePropertyKeyframe,
  transitionSource,
  type Clip,
  type Project,
  type Selection,
  type TextClip,
  type TextAnimationOptions,
  type AnimationLayer,
} from "./model";
type Props = {
  project: Project;
  selection: Selection;
  time: number;
  edit: (fn: (p: Project) => Project, group?: string) => void;
  clear: () => void;
  focusEffects?: boolean;
  previewAnimation?: (phase: "Entrance" | "Exit", item: Clip | TextClip) => void;
};
export function Inspector({
  project,
  selection,
  time,
  edit,
  clear,
  focusEffects,
  previewAnimation,
}: Props) {
  const [tab, setTab] = useState("Basic");
  const [animationPhase, setAnimationPhase] = useState<"Entrance" | "Exit">(
    "Entrance",
  );
  const [selectedAnimationName, setSelectedAnimationName] = useState<string | null>(null);
  const [customPresets, setCustomPresets] = useState<CustomAnimationPreset[]>(readCustomAnimationPresets);
  const [newPresetName, setNewPresetName] = useState("");
  const [deletePresetId, setDeletePresetId] = useState<string | null>(null);
  const [presetError, setPresetError] = useState("");
  const sourceClip =
    selection?.kind === "clip"
      ? project.clips.find((c) => c.id === selection.id)
      : undefined;
  const sourceText =
    selection?.kind === "text"
      ? project.texts.find((t) => t.id === selection.id)
      : undefined;
  const clip = sourceClip ? animatedItem(sourceClip, time) : undefined;
  const text = sourceText ? animatedItem(sourceText, time) : undefined;
  useEffect(() => {
    if (focusEffects) setTab(text ? "Effects" : "Basic");
  }, [focusEffects, text?.id]);
  const updateClip = (
    patch: Partial<Clip>,
    group = Object.keys(patch).join(),
  ) =>
    edit(
      (p) => ({
        ...p,
        clips: p.clips.map((c) => c.id === clip?.id ? applyPatch(c, patch, time, p.fps) : c),
      }),
      clip?.id + ":" + group,
    );
  const updateText = (
    patch: Partial<TextClip>,
    group = Object.keys(patch).join(),
  ) =>
    edit(
      (p) => ({
        ...p,
        texts: p.texts.map((t) => t.id === text?.id ? applyPatch(t, patch, time, p.fps) : t),
      }),
      text?.id + ":" + group,
    );
  const transform = clip
    ? interpolatedTransform(clip, time - clip.start)
    : null;
  const previousClip = clip ? transitionSource(project, clip) : undefined;
  const updateTransform = (patch: Partial<Clip>) => {
    if (!clip || !transform) return;
    if (!clip.keyframes.length || Object.keys(patch).some((name) => clip.propertyKeyframes?.[name]?.length)) updateClip(patch);
    else {
      const t = clamp(
        Math.round((time - clip.start) * project.fps) / project.fps,
        0,
        clipDuration(clip),
      );
      updateClip(
        {
          keyframes: [
            ...clip.keyframes.filter(
              (k) => Math.abs(k.time - t) > 0.5 / project.fps,
            ),
            { time: t, ...transform, ...patch },
          ].sort((a, b) => a.time - b.time),
        },
        "keyframes",
      );
    }
  };
  const keyAtTime = clip?.keyframes.find(
    (k) => Math.abs(k.time - (time - clip.start)) < 1 / project.fps,
  );
  const keyButton = (item: Clip | TextClip | undefined, name: string, value: number | string | boolean) => {
    if (!item) return undefined;
    const current = Math.round((time - item.start) * project.fps) / project.fps;
    const active = item.propertyKeyframes?.[name]?.some((key) => Math.abs(key.time - current) < 0.5 / project.fps);
    return <button type="button" className={"property-keyframe" + (active ? " active" : "")}
      aria-label={`${active ? "Remove" : "Add"} ${name} keyframe`}
      title={`${active ? "Remove" : "Add"} ${name} keyframe at playhead`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        edit((p) => ({ ...p,
          clips: p.clips.map((c) => c.id === item.id ? togglePropertyKeyframe(c, name, time - c.start, value, p.fps) : c),
          texts: p.texts.map((t) => t.id === item.id ? togglePropertyKeyframe(t, name, time - t.start, value, p.fps) : t),
        }));
      }}><Diamond size={12} fill={active ? "currentColor" : "none"} /></button>;
  };
  const ck = (name: keyof Clip, value: number | string | boolean) => keyButton(clip, String(name), value);
  const tk = (name: keyof TextClip, value: number | string | boolean) => keyButton(text, String(name), value);
  const animationItem = text ?? (clip?.kind === "video" ? clip : undefined);
  const animationLength = animationItem ? ("sourceEnd" in animationItem ? clipDuration(animationItem) : animationItem.duration) : 0;
  const phaseStack = animationItem ? animationLayers(animationItem, animationPhase) : [];
  const selectedLayer = phaseStack.find((layer) => layer.name === selectedAnimationName) ?? phaseStack[0];
  const phaseBase = selectedLayer?.name ?? "None";
  const phaseSettings = selectedLayer?.settings ?? {};
  const phaseDefaults = defaultAnimationSettings(phaseBase, animationPhase);
  const phaseOptions = { ...phaseDefaults, ...phaseSettings };
  const phaseDuration = animationItem && (animationPhase === "Entrance" ? animationItem.animationDuration : animationItem.exitAnimationDuration) || 0.5;
  const activePresetName = animationItem && (animationPhase === "Entrance" ? animationItem.animationPresetName : animationItem.exitAnimationPresetName);
  const updateAnimationItem = (patch: Partial<Clip> & Partial<TextClip>) => {
    if (text) updateText(patch);
    else if (clip) updateClip(patch);
  };
  const setAnimationStack = (layers: AnimationLayer[], presetName?: string, duration?: number) => {
    const first = layers[0];
    const patch = {
      animation: first?.name ?? "None",
      animationSettings: first?.settings ?? {},
      animationStack: layers,
      animationPresetName: presetName,
    };
    if (animationPhase === "Entrance") updateAnimationItem({ ...patch, ...(duration === undefined ? {} : { animationDuration: duration }) });
    else updateAnimationItem({
      exitAnimation: patch.animation,
      exitAnimationSettings: patch.animationSettings,
      exitAnimationStack: patch.animationStack,
      exitAnimationPresetName: patch.animationPresetName,
      ...(duration === undefined ? {} : { exitAnimationDuration: duration }),
    });
  };
  const updateAnimationOptions = (patch: TextAnimationOptions) => {
    if (!selectedLayer) return;
    setAnimationStack(phaseStack.map((layer) => layer === selectedLayer
      ? { ...layer, settings: { ...layer.settings, ...patch } } : layer));
  };
  const chooseAnimation = (name: TextClip["animation"]) => {
    if (name === "None") { setAnimationStack([]); setSelectedAnimationName(null); return; }
    const exists = phaseStack.some((layer) => layer.name === name);
    setAnimationStack(exists ? phaseStack.filter((layer) => layer.name !== name)
      : [...phaseStack, { name, settings: {} }]);
    setSelectedAnimationName(exists ? null : name);
  };
  const applyCustomPreset = (preset: CustomAnimationPreset, append = false) => {
    const incoming = (preset.layers ?? [{ name: preset.base, settings: preset.settings }])
      .map((layer) => ({ name: layer.name, settings: { ...layer.settings } }));
    const layers = append ? [...phaseStack, ...incoming.filter((layer) => !phaseStack.some((current) => current.name === layer.name))] : incoming;
    setAnimationStack(layers, append ? undefined : preset.name,
      append ? undefined : Math.min(preset.duration, animationLength));
    setSelectedAnimationName(incoming[0]?.name ?? null);
  };
  const saveCustomPreset = () => {
    if (!animationItem || !phaseStack.length || !newPresetName.trim()) return;
    const preset = createCustomAnimationPreset(newPresetName, animationPhase, phaseStack[0].name, phaseDuration, phaseStack[0].settings, phaseStack);
    const next = [...customPresets, preset].slice(-50);
    if (!writeCustomAnimationPresets(next)) { setPresetError("Could not save presets on this device."); return; }
    setCustomPresets(next);
    setNewPresetName("");
    setPresetError("");
    applyCustomPreset(preset);
  };
  const deleteCustomPreset = (id: string) => {
    if (deletePresetId !== id) { setDeletePresetId(id); return; }
    const next = customPresets.filter((preset) => preset.id !== id);
    if (!writeCustomAnimationPresets(next)) { setPresetError("Could not delete the saved preset."); return; }
    setCustomPresets(next);
    setDeletePresetId(null);
  };
  const activeTab = (text
    ? ["Basic", "Style", "Animation", "Effects"]
    : clip?.kind === "audio" ? ["Basic", "Audio"] : ["Basic", "Animation", "Color", "Audio"]
  ).includes(tab)
    ? tab
    : "Basic";
  return (
    <aside className="inspector">
      <div className="panel-heading">
        <span>
          <SlidersHorizontal size={15} /> Inspector
        </span>
        {selection && (
          <button title="Deselect" aria-label="Deselect clip" onClick={clear}>
            <X size={15} />
          </button>
        )}
      </div>
      {!clip && !text ? (
        <div className="inspector-scroll">
          <div className="inspector-empty">
            <div className="empty-icon">
              <SlidersHorizontal size={24} />
            </div>
            <h3>Make every detail yours</h3>
            <p>
              Select a clip or text layer to adjust its look, motion, and sound.
            </p>
          </div>
          <Section title="Project settings">
            <Field label="Canvas">
              <select
                value={project.ratio}
                onChange={(e) =>
                  edit((p) => ({
                    ...p,
                    ratio: e.target.value as Project["ratio"],
                  }))
                }
              >
                {["16:9", "9:16", "1:1", "4:5"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="Frame rate">
              <select
                value={project.fps}
                onChange={(e) => edit((p) => ({ ...p, fps: +e.target.value }))}
              >
                <option value="30">30 fps</option>
                <option value="60">60 fps</option>
              </select>
            </Field>
            <Color
              label="Background"
              value={project.background}
              onChange={(v) =>
                edit((p) => ({ ...p, background: v }), "background")
              }
            />
          </Section>
          <div className="inspector-tip">
            Everything stays on your device. Make a project backup to move your
            edit and its media to another computer.
          </div>
        </div>
      ) : (
        <>
          <div className="selected-heading">
            <span
              className={
                "selected-kind " +
                (text
                  ? "text-kind"
                  : clip?.kind === "audio"
                    ? "audio-kind"
                    : "")
              }
            >
              {text ? (
                <Type size={17} />
              ) : clip?.kind === "audio" ? (
                <Music2 size={17} />
              ) : (
                <Film size={17} />
              )}
            </span>
            <div>
              <strong>{text ? "Text layer" : clip?.label}</strong>
              <span>
                {text
                  ? clock(text.duration, true)
                  : clock(clipDuration(clip!), true)}{" "}
                duration
              </span>
            </div>
          </div>
          <div className="inspector-tabs">
            {(text
              ? ["Basic", "Style", "Animation", "Effects"]
              : clip?.kind === "audio"
                ? ["Basic", "Audio"]
                : ["Basic", "Animation", "Color", "Audio"]
            ).map((t) => (
              <button
                className={activeTab === t ? "active" : ""}
                key={t}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="inspector-scroll">
            {text && activeTab === "Basic" && (
              <>
                <Section title="Content">
                  <div className="field-label">Text {tk("text", text.text)}</div>
                  <textarea
                    aria-label="Text content"
                    value={text.text}
                    rows={3}
                    onChange={(e) => updateText({ text: e.target.value })}
                  />
                  <Field label="Font" keyframe={tk("fontFamily", text.fontFamily)}>
                    <select
                      value={text.fontFamily}
                      onChange={(e) =>
                        updateText({ fontFamily: e.target.value })
                      }
                    >
                      {FONTS.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="field-grid">
                    <NumberField
                      label="Size"
                      keyframe={tk("fontSize", text.fontSize)}
                      value={text.fontSize}
                      min={12}
                      max={400}
                      onChange={(v) => updateText({ fontSize: v })}
                    />
                    <Field label="Weight" keyframe={tk("fontWeight", text.fontWeight)}>
                      <select
                        value={text.fontWeight}
                        onChange={(e) =>
                          updateText({ fontWeight: +e.target.value })
                        }
                      >
                        {[400, 500, 600, 700, 800, 900].map((w) => (
                          <option key={w}>{w}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="text-format">
                    <div className="field-label">{tk("italic", text.italic)}<button
                      className={text.italic ? "active italic" : "italic"}
                      title="Italic"
                      onClick={() => updateText({ italic: !text.italic })}
                    >
                      I
                    </button></div>
                    <div className="segmented">
                      {tk("align", text.align)}
                      {(["left", "center", "right"] as const).map(
                        (align, i) => (
                          <button
                            key={align}
                            title={"Align " + align}
                            aria-label={"Align " + align}
                            className={text.align === align ? "active" : ""}
                            onClick={() => updateText({ align })}
                          >
                            {i === 0 ? (
                              <AlignLeft size={16} />
                            ) : i === 1 ? (
                              <AlignCenter size={16} />
                            ) : (
                              <AlignRight size={16} />
                            )}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                  <Color
                    label="Text color"
                    keyframe={tk("color", text.color)}
                    value={text.color}
                    onChange={(v) => updateText({ color: v })}
                  />
                </Section>
                <Section title="Position & timing">
                  <div className="field-grid">
                    <NumberField
                      label="X (%)"
                      keyframe={tk("x", text.x)}
                      value={text.x * 100}
                      min={-50}
                      max={150}
                      onChange={(v) => updateText({ x: v / 100 })}
                    />
                    <NumberField
                      label="Y (%)"
                      keyframe={tk("y", text.y)}
                      value={text.y * 100}
                      min={-50}
                      max={150}
                      onChange={(v) => updateText({ y: v / 100 })}
                    />
                  </div>
                  <Range
                    label="Rotation"
                    value={text.rotation}
                    keyframe={tk("rotation", text.rotation)}
                    min={-180}
                    max={180}
                    suffix="°"
                    onChange={(v) => updateText({ rotation: v })}
                  />
                  <Range
                    label="Opacity"
                    value={text.opacity * 100}
                    keyframe={tk("opacity", text.opacity)}
                    min={0}
                    max={100}
                    suffix="%"
                    onChange={(v) => updateText({ opacity: v / 100 })}
                  />
                  <div className="field-grid">
                    <NumberField
                      label="Start (s)"
                      value={text.start}
                      min={0}
                      max={36000}
                      step={0.1}
                      onChange={(v) => updateText({ start: v })}
                    />
                    <NumberField
                      label="Duration (s)"
                      value={text.duration}
                      min={1 / project.fps}
                      max={36000}
                      step={0.1}
                      onChange={(v) => updateText({ duration: v })}
                    />
                  </div>
                </Section>
              </>
            )}
            {text && activeTab === "Style" && (
              <>
                <Section title="Spacing">
                  <Range
                    label="Letter spacing"
                    keyframe={tk("letterSpacing", text.letterSpacing)}
                    value={text.letterSpacing}
                    min={-5}
                    max={30}
                    onChange={(v) => updateText({ letterSpacing: v })}
                  />
                  <Range
                    label="Line height"
                    keyframe={tk("lineHeight", text.lineHeight)}
                    value={text.lineHeight}
                    min={0.7}
                    max={2.5}
                    step={0.05}
                    onChange={(v) => updateText({ lineHeight: v })}
                  />
                </Section>
                <Section title="Outline">
                  <Range
                    label="Thickness"
                    keyframe={tk("strokeWidth", text.strokeWidth)}
                    value={text.strokeWidth}
                    min={0}
                    max={16}
                    onChange={(v) => updateText({ strokeWidth: v })}
                  />
                  <Color
                    label="Outline color"
                    keyframe={tk("strokeColor", text.strokeColor)}
                    value={text.strokeColor}
                    onChange={(v) => updateText({ strokeColor: v })}
                  />
                </Section>
                <Section title="Shadow & glow">
                  <Color
                    label="Shadow color"
                    keyframe={tk("shadowColor", text.shadowColor)}
                    value={text.shadowColor}
                    onChange={(v) => updateText({ shadowColor: v })}
                  />
                  <Range
                    label="Blur"
                    keyframe={tk("shadowBlur", text.shadowBlur)}
                    value={text.shadowBlur}
                    min={0}
                    max={60}
                    onChange={(v) => updateText({ shadowBlur: v })}
                  />
                  <Range
                    label="Offset"
                    keyframe={tk("shadowOffset", text.shadowOffset)}
                    value={text.shadowOffset}
                    min={0}
                    max={30}
                    onChange={(v) => updateText({ shadowOffset: v })}
                  />
                </Section>
                <Section title="Background">
                  <Toggle
                    label="Text background"
                    keyframe={tk("background", text.background)}
                    value={text.background}
                    onChange={(v) => updateText({ background: v })}
                  />
                  {text.background && (
                    <>
                      <Color
                        label="Fill"
                        keyframe={tk("backgroundColor", text.backgroundColor)}
                        value={text.backgroundColor}
                        onChange={(v) => updateText({ backgroundColor: v })}
                      />
                      <Range
                        label="Opacity"
                        keyframe={tk("backgroundOpacity", text.backgroundOpacity)}
                        value={text.backgroundOpacity * 100}
                        min={0}
                        max={100}
                        suffix="%"
                        onChange={(v) =>
                          updateText({ backgroundOpacity: v / 100 })
                        }
                      />
                      <Range
                        label="Padding"
                        keyframe={tk("padding", text.padding)}
                        value={text.padding}
                        min={0}
                        max={60}
                        onChange={(v) => updateText({ padding: v })}
                      />
                      <Range
                        label="Corner radius"
                        keyframe={tk("radius", text.radius)}
                        value={text.radius}
                        min={0}
                        max={80}
                        onChange={(v) => updateText({ radius: v })}
                      />
                    </>
                  )}
                </Section>
              </>
            )}
            {text && activeTab === "Effects" && (
              <EffectsControls
                effects={text.effects ?? []}
                keyframe={(name, amount) => keyButton(text, `effect:${name}`, amount)}
                onChange={(effects, group) => updateText({ effects }, group)}
              />
            )}
            {animationItem && activeTab === "Animation" && (
              <>
                <div
                  className="animation-phase"
                  role="group"
                  aria-label="Animation phase"
                >
                  {(["Entrance", "Exit"] as const).map((phase) => (
                    <button
                      key={phase}
                      aria-pressed={animationPhase === phase}
                      className={animationPhase === phase ? "active" : ""}
                      onClick={() => { setAnimationPhase(phase); setDeletePresetId(null); }}
                    >
                      {phase}
                    </button>
                  ))}
                </div>
                {animationPhase === "Entrance" && (
                  <Section title="Entrance">
                    <div className="choice-grid">
                      {ANIMATIONS.map((a) => (
                        <button
                          key={a}
                          aria-label={"Entrance " + a}
                          aria-pressed={a === "None" ? phaseStack.length === 0 : phaseStack.some((layer) => layer.name === a)}
                          className={(a === "None" ? phaseStack.length === 0 : phaseStack.some((layer) => layer.name === a)) ? "active" : ""}
                          onClick={() => chooseAnimation(a)}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                    <Range
                      label="Entrance duration"
                      value={animationItem.animationDuration ?? 0.5}
                      min={0}
                      max={animationLength}
                      step={0.1}
                      suffix="s"
                      onChange={(v) => updateAnimationItem({ animationDuration: v })}
                    />
                  </Section>
                )}
                {animationPhase === "Exit" && (
                  <Section title="Exit">
                    <div className="choice-grid">
                      {ANIMATIONS.map((a) => (
                        <button
                          key={a}
                          aria-label={"Exit " + a}
                          aria-pressed={a === "None" ? phaseStack.length === 0 : phaseStack.some((layer) => layer.name === a)}
                          className={(a === "None" ? phaseStack.length === 0 : phaseStack.some((layer) => layer.name === a)) ? "active" : ""}
                          onClick={() => chooseAnimation(a)}
                        >
                          {a === "Typewriter" ? "Erase" : a}
                        </button>
                      ))}
                    </div>
                    <Range
                      label="Exit duration"
                      value={animationItem.exitAnimationDuration ?? 0.5}
                      min={0}
                      max={animationLength}
                      step={0.1}
                      suffix="s"
                      onChange={(v) => updateAnimationItem({ exitAnimationDuration: v })}
                    />
                  </Section>
                )}
                <p className="field-note animation-stack-hint">Select more than one animation to stack them. Click a selected animation again to remove it.</p>
                {phaseStack.length > 0 && <div className="animation-stack-list" aria-label={`${animationPhase} animation stack`}>
                  {phaseStack.map((layer, index) => <button key={index} className={selectedLayer === layer ? "active" : ""}
                    aria-label={`Edit ${layer.name} in ${animationPhase.toLowerCase()} stack`}
                    onClick={() => setSelectedAnimationName(layer.name)}>{index + 1}. {layer.name}</button>)}
                </div>}
                {selectedLayer && (
                  <Section title={`Fine tune · ${phaseBase}`} action={previewAnimation ? <button title={`Preview ${animationPhase.toLowerCase()}`} aria-label={`Preview ${animationPhase.toLowerCase()} animation`} onClick={() => previewAnimation(animationPhase, animationItem)}><Play size={14} /></button> : undefined}>
                    {activePresetName && <p className="animation-preset-label">Using “{activePresetName}” · edits here only change this clip.</p>}
                    <AnimationTuner name={phaseBase} options={phaseOptions} onChange={updateAnimationOptions} />
                    <p className="field-note">These settings change only {phaseBase} in the stack. Preview or scrub to see the combined motion.</p>
                  </Section>
                )}
                <Section title={`My ${animationPhase.toLowerCase()} presets`}>
                  {customPresets.filter((preset) => preset.phase === animationPhase).length ? (
                    <div className="custom-animation-list">
                      {customPresets.filter((preset) => preset.phase === animationPhase).map((preset) => (
                        <div className="custom-animation-item" key={preset.id}>
                          <button className="custom-animation-apply" onClick={() => applyCustomPreset(preset)} title={`Replace stack with ${preset.name}`}>
                            <strong>{preset.name}</strong><small>{(preset.layers ?? [{name: preset.base}]).map((layer) => layer.name).join(" + ")} · {preset.duration.toFixed(1)}s</small>
                          </button>
                          <button aria-label={`Add ${preset.name} to stack`} title={`Add ${preset.name} to this stack`} onClick={() => applyCustomPreset(preset, true)}>+</button>
                          <button className={deletePresetId === preset.id ? "danger" : ""} aria-label={deletePresetId === preset.id ? `Confirm delete ${preset.name}` : `Delete ${preset.name}`} title={deletePresetId === preset.id ? "Click again to delete" : "Delete saved preset"} onClick={() => deleteCustomPreset(preset.id)}><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                  ) : <p className="field-note">No saved {animationPhase.toLowerCase()} animations yet.</p>}
                  <div className="animation-save-row">
                    <input aria-label="New animation preset name" value={newPresetName} maxLength={42} placeholder="Name this animation" onChange={(event) => setNewPresetName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveCustomPreset(); }} />
                    <button className="button secondary" title="Save current animation stack" disabled={!newPresetName.trim() || !phaseStack.length} onClick={saveCustomPreset}><Save size={14} /> Save</button>
                  </div>
                  {presetError && <p className="field-note" role="alert">{presetError}</p>}
                  <p className="field-note">Click a preset to replace this phase, or + to add it to the stack. Saved locally; applied motion stays in your project backup.</p>
                </Section>
                <div className="inspector-tip">
                  Scrub the start or end of this clip to preview. On short
                  clips, durations scale together so entrance and exit never
                  overlap. Effective timing:{" "}
                  {textAnimationTiming(animationItem).entranceDuration.toFixed(2)}s in
                  {" / "}
                  {textAnimationTiming(animationItem).exitDuration.toFixed(2)}s out.
                </div>
              </>
            )}
            {clip && activeTab === "Basic" && (
              <>
                <Section title="Clip">
                  <Field label="Name">
                    <input
                      value={clip.label}
                      aria-label="Clip name"
                      onChange={(e) => updateClip({ label: e.target.value })}
                    />
                  </Field>
                  <div className="field-grid">
                    <NumberField
                      label="Start (s)"
                      value={clip.start}
                      min={0}
                      max={36000}
                      step={1 / project.fps}
                      onChange={(v) => updateClip({ start: v })}
                    />
                    <Field label="Speed">
                      <select
                        value={clip.speed}
                        onChange={(e) => updateClip({ speed: +e.target.value })}
                      >
                        {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((v) => (
                          <option key={v} value={v}>
                            {v}×
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <p className="field-note">
                    Speed changes this clip’s duration. Other clips stay in
                    place.
                  </p>
                </Section>
                {clip.kind === "video" && transform && (
                  <>
                    <Section
                      title="Transform"
                      action={
                        <button
                          title="Reset transform and keyframes"
                          aria-label="Reset transform"
                          onClick={() => edit((p) => ({ ...p, clips: p.clips.map((c) => {
                            if (c.id !== clip.id) return c;
                            const propertyKeyframes = { ...c.propertyKeyframes };
                            for (const name of ["x", "y", "scale", "rotation", "opacity", "flipX", "flipY", "fit"]) delete propertyKeyframes[name];
                            return { ...c, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false, fit: (p.assets.find((a) => a.id === c.assetId)?.kind === "image" ? "contain" : "cover") as Clip["fit"], fitExplicit: false, keyframes: [], propertyKeyframes };
                          }) }))}
                        >
                          <RotateCcw size={14} />
                        </button>
                      }
                    >
                      <div className="keyframe-row">
                        <span>Motion keyframe</span>
                        <button
                          title={
                            keyAtTime
                              ? "Remove keyframe here"
                              : "Add keyframe here"
                          }
                          className={keyAtTime ? "active" : ""}
                          onClick={() => {
                            const t = clamp(
                              Math.round((time - clip.start) * project.fps) /
                                project.fps,
                              0,
                              clipDuration(clip),
                            );
                            updateClip(
                              {
                                keyframes: keyAtTime
                                  ? clip.keyframes.filter(
                                      (k) => k !== keyAtTime,
                                    )
                                  : [
                                      ...clip.keyframes,
                                      { time: t, ...transform },
                                    ].sort((a, b) => a.time - b.time),
                              },
                              "",
                            );
                          }}
                        >
                          <Diamond
                            size={14}
                            fill={keyAtTime ? "currentColor" : "none"}
                          />
                          {keyAtTime ? "Remove" : "Add"}
                        </button>
                      </div>
                      <Range
                        label="Scale"
                        keyframe={ck("scale", transform.scale)}
                        value={transform.scale * 100}
                        min={5}
                        max={300}
                        suffix="%"
                        onChange={(v) => updateTransform({ scale: v / 100 })}
                      />
                      <div className="field-grid">
                        <NumberField
                          label="X (%)"
                          keyframe={ck("x", transform.x)}
                          value={transform.x * 100}
                          min={-200}
                          max={200}
                          onChange={(v) => updateTransform({ x: v / 100 })}
                        />
                        <NumberField
                          label="Y (%)"
                          keyframe={ck("y", transform.y)}
                          value={transform.y * 100}
                          min={-200}
                          max={200}
                          onChange={(v) => updateTransform({ y: v / 100 })}
                        />
                      </div>
                      <Range
                        label="Rotation"
                        value={transform.rotation}
                        keyframe={ck("rotation", transform.rotation)}
                        min={-180}
                        max={180}
                        suffix="°"
                        onChange={(v) => updateTransform({ rotation: v })}
                      />
                      <Range
                        label="Opacity"
                        value={transform.opacity * 100}
                        keyframe={ck("opacity", transform.opacity)}
                        min={0}
                        max={100}
                        suffix="%"
                        onChange={(v) => updateTransform({ opacity: v / 100 })}
                      />
                      <div className="field-grid">
                        <Field label="Fit" keyframe={ck("fit", clip.fit)}>
                          <select
                            value={clip.fit}
                            onChange={(e) =>
                              updateClip({ fit: e.target.value as Clip["fit"], fitExplicit: true })
                            }
                          >
                            <option value="cover">Fill frame</option>
                            <option value="contain">Fit inside</option>
                          </select>
                        </Field>
                        <div className="flip-controls">
                          {ck("flipX", clip.flipX)}
                          <button
                            className={clip.flipX ? "active" : ""}
                            title="Flip horizontal"
                            aria-label="Flip horizontal"
                            onClick={() => updateClip({ flipX: !clip.flipX })}
                          >
                            <FlipHorizontal2 size={17} />
                          </button>
                          {ck("flipY", clip.flipY)}
                          <button
                            className={clip.flipY ? "active" : ""}
                            title="Flip vertical"
                            aria-label="Flip vertical"
                            onClick={() => updateClip({ flipY: !clip.flipY })}
                          >
                            <FlipVertical2 size={17} />
                          </button>
                        </div>
                      </div>
                      {clip.keyframes.length > 0 && (
                        <p className="field-note">
                          {clip.keyframes.length} keyframes · adjustments add a
                          keyframe at the playhead. Motion eases between them.
                        </p>
                      )}
                    </Section>
                    <Section title="Incoming transition">
                      <Field label="Style">
                        <select
                          value={clip.transition}
                          onChange={(e) => {
                            if (!previousClip && e.target.value !== "None") return;
                            updateClip({ transition: e.target.value as Clip["transition"] });
                          }}
                        >
                          {TRANSITIONS.map((t) => (
                            <option key={t.name} disabled={!previousClip && t.name !== "None"}>{t.name}</option>
                          ))}
                        </select>
                      </Field>
                      {previousClip && (
                        <Range
                          label="Duration"
                          value={clip.transitionDuration}
                          min={1 / project.fps}
                          max={Math.min(3, clipDuration(clip), previousClip ? clipDuration(previousClip) : 3)}
                          step={1 / project.fps}
                          suffix="s"
                          onChange={(v) =>
                            updateClip({ transitionDuration: v })
                          }
                        />
                      )}
                      <p className="field-note">
                        {previousClip
                          ? "Set the duration, then choose a style. Both clips animate across the cut; source handles play through when available, otherwise the edge frame is held."
                          : "Place another visual clip immediately before this one on the same layer to add a transition."}
                      </p>
                    </Section>
                    <Section title={"Effects · " + clip.effects.length}>
                      {clip.effects.length === 0 ? (
                        <p className="field-note">
                          Add effects from the Effects library. Stack them and
                          tune each amount here.
                        </p>
                      ) : (
                        clip.effects.map((effect) => (
                          <div className="effect-control" key={effect.name}>
                            <Range
                              label={effect.name}
                              keyframe={keyButton(clip, `effect:${effect.name}`, effect.amount)}
                              value={effect.amount}
                              min={0}
                              max={100}
                              suffix="%"
                              onChange={(v) =>
                                updateClip(
                                  {
                                    effects: clip.effects.map((e) =>
                                      e.name === effect.name
                                        ? { ...e, amount: v }
                                        : e,
                                    ),
                                  },
                                  effect.name,
                                )
                              }
                            />
                            <button
                              title={"Remove " + effect.name}
                              aria-label={"Remove " + effect.name}
                              onClick={() =>
                                updateClip(
                                  {
                                    effects: clip.effects.filter(
                                      (e) => e.name !== effect.name,
                                    ),
                                  },
                                  "",
                                )
                              }
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))
                      )}
                    </Section>
                  </>
                )}
              </>
            )}
            {clip && activeTab === "Color" && (
              <Section
                title="Color adjustments"
                action={
                  <button
                    title="Reset color"
                    aria-label="Reset color"
                    onClick={() => edit((p) => ({ ...p, clips: p.clips.map((c) => {
                      if (c.id !== clip.id) return c;
                      const propertyKeyframes = { ...c.propertyKeyframes };
                      for (const name of ["brightness", "contrast", "saturation", "temperature", "filter"]) delete propertyKeyframes[name];
                      return { ...c, brightness: 100, contrast: 100, saturation: 100, temperature: 0, filter: "Original", propertyKeyframes };
                    }) }))}
                  >
                    <RotateCcw size={14} />
                  </button>
                }
              >
                <div className="current-look">
                  Look {ck("filter", clip.filter)} <span>{clip.filter}</span>
                </div>
                <Range
                  label="Brightness"
                  keyframe={ck("brightness", clip.brightness)}
                  value={clip.brightness}
                  min={0}
                  max={200}
                  onChange={(v) => updateClip({ brightness: v })}
                />
                <Range
                  label="Contrast"
                  keyframe={ck("contrast", clip.contrast)}
                  value={clip.contrast}
                  min={0}
                  max={200}
                  onChange={(v) => updateClip({ contrast: v })}
                />
                <Range
                  label="Saturation"
                  keyframe={ck("saturation", clip.saturation)}
                  value={clip.saturation}
                  min={0}
                  max={200}
                  onChange={(v) => updateClip({ saturation: v })}
                />
                <Range
                  label="Temperature"
                  keyframe={ck("temperature", clip.temperature)}
                  value={clip.temperature}
                  min={-100}
                  max={100}
                  onChange={(v) => updateClip({ temperature: v })}
                />
              </Section>
            )}
            {clip && activeTab === "Audio" && (
              <Section title="Audio">
                <Range
                  label="Volume"
                  keyframe={ck("volume", clip.volume)}
                  value={clip.volume * 100}
                  min={0}
                  max={200}
                  suffix="%"
                  onChange={(v) => updateClip({ volume: v / 100 })}
                />
                <Range
                  label="Fade in"
                  value={clip.fadeIn}
                  min={0}
                  max={Math.min(10, clipDuration(clip))}
                  step={0.1}
                  suffix="s"
                  onChange={(v) => updateClip({ fadeIn: v })}
                />
                <Range
                  label="Fade out"
                  value={clip.fadeOut}
                  min={0}
                  max={Math.min(10, clipDuration(clip))}
                  step={0.1}
                  suffix="s"
                  onChange={(v) => updateClip({ fadeOut: v })}
                />
                <p className="field-note">
                  Volume and fades are included in export. Muted and hidden
                  tracks stay silent.
                </p>
              </Section>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
function AnimationTuner({ name, options, onChange }: {
  name: TextClip["animation"];
  options: TextAnimationOptions;
  onChange: (patch: TextAnimationOptions) => void;
}) {
  const directional = ["Rise", "Drop", "Slide", "Slide right", "Bounce", "Drift", "Custom"].includes(name);
  const scalable = ["Zoom", "Shrink", "Pop", "Elastic", "Custom"].includes(name);
  const zoomDirection = ["Zoom", "Shrink", "Custom"].includes(name);
  const angle = (((options.angle ?? 0) % 360) + 360) % 360;
  return <div className="animation-tuner">
    {directional && <>
      <div className="animation-directions" role="group" aria-label="Motion direction">
        {([["Right", 0, "→"], ["Down", 90, "↓"], ["Left", 180, "←"], ["Up", 270, "↑"]] as const).map(([label, value, icon]) =>
          <button key={label} type="button" aria-label={`Move ${label.toLowerCase()}`} className={Math.abs(angle - value) < 0.01 ? "active" : ""} onClick={() => onChange({ angle: value })}>{icon}</button>)}
      </div>
      <Range label="Direction" value={angle} min={0} max={360} suffix="°" onChange={(value) => onChange({ angle: value })} />
      <Range label="Distance" value={(options.distance ?? 0) * 100} min={0} max={100} suffix="%" onChange={(value) => onChange({ distance: value / 100 })} />
    </>}
    {scalable && <>
      {zoomDirection && <div className="animation-zoom-choice" role="group" aria-label="Zoom direction">
        <button type="button" className={options.zoomDirection !== "out" ? "active" : ""} onClick={() => onChange({ zoomDirection: "in" })}>Zoom in</button>
        <button type="button" className={options.zoomDirection === "out" ? "active" : ""} onClick={() => onChange({ zoomDirection: "out" })}>Zoom out</button>
      </div>}
      <Range label={zoomDirection ? "Zoom strength" : "Scale strength"} value={(options.zoomAmount ?? 0) * 100} min={0} max={zoomDirection && options.zoomDirection !== "out" ? 200 : 95} suffix="%" onChange={(value) => onChange({ zoomAmount: value / 100 })} />
    </>}
    <Range label="Rotation" value={options.rotation ?? 0} min={-360} max={360} suffix="°" onChange={(value) => onChange({ rotation: value })} />
    <Range label="Blur" value={(options.blur ?? 0) * 100} min={0} max={10} step={0.1} suffix="%" onChange={(value) => onChange({ blur: value / 100 })} />
    {!(["Typewriter", "Wipe left", "Wipe right", "Wipe up", "Wipe down"].includes(name)) &&
      <Toggle label="Fade in / disappear" value={options.fade !== false} onChange={(value) => onChange({ fade: value })} />}
    <Field label="Easing">
      <select value={options.easing ?? "ease-out"} onChange={(event) => onChange({ easing: event.target.value as TextAnimationOptions["easing"] })}>
        <option value="ease-out">Ease out</option><option value="ease-in-out">Ease in & out</option>
        <option value="ease-in">Ease in</option><option value="linear">Linear</option>
      </select>
    </Field>
  </div>;
}
function applyPatch<T extends Clip | TextClip>(item: T, patch: Partial<T>, time: number, fps: number): T {
  let next = { ...item };
  for (const [name, value] of Object.entries(patch)) {
    if (name === "effects" && Array.isArray(value)) {
      const incoming = value as Clip["effects"];
      next.effects = incoming.map((effect) => {
        const track = `effect:${effect.name}`;
        if (!item.propertyKeyframes?.[track]?.length) return effect;
        next = setPropertyKeyframe(next, track, time - item.start, effect.amount, fps);
        return item.effects.find((old) => old.name === effect.name) ?? effect;
      });
    } else if ((typeof value === "number" || typeof value === "string" || typeof value === "boolean") && item.propertyKeyframes?.[name]?.length) {
      next = setPropertyKeyframe(next, name, time - item.start, value, fps);
    } else {
      (next as unknown as Record<string, unknown>)[name] = value;
    }
  }
  return next;
}
function EffectsControls({
  effects,
  onChange,
  keyframe,
}: {
  effects: Clip["effects"];
  onChange: (effects: Clip["effects"], group: string) => void;
  keyframe?: (name: string, amount: number) => ReactNode;
}) {
  return (
    <Section title={"Effects · " + effects.length}>
      {!effects.length && (
        <p className="field-note">
          Add effects from the Effects library. They apply only to this text
          clip, including its outline and background.
        </p>
      )}
      {effects.map((effect) => (
        <div className="effect-control" key={effect.name}>
          <Range
            label={effect.name}
            keyframe={keyframe?.(effect.name, effect.amount)}
            value={effect.amount}
            min={0}
            max={100}
            suffix="%"
            onChange={(amount) =>
              onChange(
                effects.map((e) =>
                  e.name === effect.name ? { ...e, amount } : e,
                ),
                effect.name,
              )
            }
          />
          <button
            title={"Remove " + effect.name}
            aria-label={"Remove " + effect.name}
            onClick={() =>
              onChange(
                effects.filter((e) => e.name !== effect.name),
                "",
              )
            }
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </Section>
  );
}
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="inspector-section">
      <div className="section-heading">
        <h3>{title}</h3>
        {action ?? <ChevronDown size={13} />}
      </div>
      {children}
    </section>
  );
}
export function Field({
  label,
  children,
  keyframe,
}: {
  label: string;
  children: ReactNode;
  keyframe?: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}{keyframe}</span>
      {children}
    </label>
  );
}
function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  keyframe,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  keyframe?: ReactNode;
}) {
  return (
    <Field label={label} keyframe={keyframe}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Math.round(value * 1000) / 1000}
        onChange={(e) => {
          if (e.target.value !== "") onChange(clamp(+e.target.value, min, max));
        }}
      />
    </Field>
  );
}
function Range({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
  keyframe,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
  keyframe?: ReactNode;
}) {
  return (
    <div className="range-field">
      <div>
        <label>{label}{keyframe}</label>
        <span>
          <input
            aria-label={label + " value"}
            type="number"
            value={Math.round(value * 100) / 100}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              if (e.target.value !== "")
                onChange(clamp(+e.target.value, min, max));
            }}
          />
          {suffix}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={
          {
            "--range-fill":
              ((value - min) / Math.max(0.000001, max - min)) * 100 + "%",
          } as React.CSSProperties
        }
      />
    </div>
  );
}
function Color({
  label,
  value,
  onChange,
  keyframe,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyframe?: ReactNode;
}) {
  return (
    <label className="color-field">
      <span className="field-label">{label}{keyframe}</span>
      <div>
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span>{value.toUpperCase()}</span>
      </div>
    </label>
  );
}
function Toggle({
  label,
  value,
  onChange,
  keyframe,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  keyframe?: ReactNode;
}) {
  return (
    <label className="toggle-field">
      <span className="field-label">{label}{keyframe}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch" />
    </label>
  );
}
