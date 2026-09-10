import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  describeNeumorphicInteractionMode,
  installNeumorphicInteractions,
  NEUMORPHIC_INTERACTION_MODE_LIST,
  NEUMORPHIC_INTERACTION_MODES,
  readNeumorphicInteractionMode,
  type NeumorphicInteractionController,
} from './neumorphic-interactions';

type InteractionMode = (typeof NEUMORPHIC_INTERACTION_MODE_LIST)[number];

interface NeumorphicInteractionHostProps {
  children: ReactNode;
  defaultMode?: InteractionMode;
  showSwitcher?: boolean;
}

function shouldShowSwitcher(explicit?: boolean) {
  if (typeof explicit === 'boolean') return explicit;
  const params = new URLSearchParams(window.location.search);
  return params.get('neuLab') === '1' || params.get('interactionLab') === '1';
}

export function NeumorphicInteractionHost({
  children,
  defaultMode = NEUMORPHIC_INTERACTION_MODES.EDGE,
  showSwitcher,
}: NeumorphicInteractionHostProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<NeumorphicInteractionController | null>(null);
  const [mode, setMode] = useState<InteractionMode>(() => readNeumorphicInteractionMode(defaultMode) as InteractionMode);
  const [switcherVisible, setSwitcherVisible] = useState(() => shouldShowSwitcher(showSwitcher));
  const [panelOpen, setPanelOpen] = useState(() => shouldShowSwitcher(showSwitcher));
  const description = useMemo(() => describeNeumorphicInteractionMode(mode), [mode]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const controller = installNeumorphicInteractions(root, { mode });
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.altKey && event.shiftKey)) return;
      if (event.code === 'KeyI') {
        event.preventDefault();
        setSwitcherVisible(true);
        setPanelOpen(value => !value);
        return;
      }
      const index = ['Digit1', 'Digit2', 'Digit3'].indexOf(event.code);
      if (index >= 0) {
        event.preventDefault();
        setMode(NEUMORPHIC_INTERACTION_MODE_LIST[index] as InteractionMode);
        setSwitcherVisible(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div ref={rootRef} className="neu-interaction-host" data-neu-interaction={mode}>
      {children}

      {switcherVisible && (
        <>
          <button
            className="neu-mode-switcher-toggle"
            type="button"
            aria-label="切换工作框动态方案"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen(value => !value)}
            title="交互方案 · Alt+Shift+I"
          >
            ◫
          </button>

          {panelOpen && (
            <aside className="neu-mode-switcher" aria-label="新拟物工作框交互方案">
              <div className="neu-mode-switcher__header">
                <div>
                  <strong>{description.title}</strong>
                  <small>{description.description}</small>
                </div>
                <button type="button" aria-label="关闭交互方案面板" onClick={() => setPanelOpen(false)}>×</button>
              </div>

              <div className="neu-mode-switcher__options">
                {NEUMORPHIC_INTERACTION_MODE_LIST.map((candidate, index) => {
                  const item = describeNeumorphicInteractionMode(candidate);
                  return (
                    <button
                      key={candidate}
                      type="button"
                      className="neu-mode-switcher__option"
                      aria-pressed={mode === candidate}
                      onClick={() => setMode(candidate as InteractionMode)}
                    >
                      <span>{index + 1}</span>
                      <strong>{item.shortTitle}</strong>
                      <small>{item.description}</small>
                    </button>
                  );
                })}
              </div>

              <p className="neu-mode-switcher__hint">
                快捷键：Alt+Shift+1/2/3 切换，Alt+Shift+I 收起。生产默认推荐“边缘抽出”。
              </p>
              <span className="neu-mode-switcher__live" aria-live="polite">当前方案：{description.shortTitle}</span>
            </aside>
          )}
        </>
      )}
    </div>
  );
}
