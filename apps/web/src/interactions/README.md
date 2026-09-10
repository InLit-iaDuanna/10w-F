# Neumorphic Interaction Runtime

## Default

`NeumorphicInteractionHost` defaults to `edge-extrusion`, the most stable mode for the existing Dockview workbench.

```tsx
<NeumorphicInteractionHost>
  <ShellWorkbench unified />
</NeumorphicInteractionHost>
```

Import order in `main.tsx`:

```ts
import './styles/neumorphic-theme.css';
import './interactions/neumorphic-interactions.css';
```

## Modes

```text
surface-extrusion  Screen membrane grows from the trigger point.
edge-extrusion     Workframe reveals from its Dock / Split edge.
depth-stack        Active workframe rises above inactive frames.
```

URL:

```text
?neuMotion=surface-extrusion
?neuMotion=edge-extrusion
?neuMotion=depth-stack
```

Add `&neuLab=1` to show the runtime selector.

Keyboard:

```text
Alt+Shift+1 / 2 / 3  select a mode
Alt+Shift+I          toggle the selector
```

## Programmatic origin

```ts
window.dispatchEvent(new CustomEvent('sceneops:neumorphic-open-source', {
  detail: { element: event.currentTarget, placement },
}));
```

The optional `ShellWorkbench` patch emits the same event for every `open(editorId, placement)` call.

## Exit

```ts
import { requestNeumorphicFrameClose } from './neumorphic-interactions';
await requestNeumorphicFrameClose(frameElement, { edge: 'right' });
await closeEditor(instanceId);
```

The runtime does not intercept Dockview close events automatically. Visual code must never delay or reorder a business close transaction unless the close UI explicitly opts in.
