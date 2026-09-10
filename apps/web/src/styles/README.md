# SceneOps Forge 新拟物主题

本目录只负责视觉材料和交互状态，不改变工作台命令、Dockview 布局、模块注册、数据请求或生产执行逻辑。

## 入口

`neumorphic-theme.css` 是唯一入口，由 `apps/web/src/main.tsx` 在工作台代码之后加载。主题拆为七个边界清晰的文件：

- `neumorphic-tokens.css`：颜色、阴影、圆角、动效、基础控件与无障碍规则；
- `neumorphic-shell.css`：应用栏、根工作区、错误提示和诊断面板；
- `neumorphic-dockview.css`：Dockview、区域标题、菜单、分割条和四边拉手；
- `neumorphic-conversation.css`：统一对话、旧对话视图和模型供应商设置；
- `neumorphic-planning.css`：PlanningJourney；
- `neumorphic-workspace-modules.css`：项目、集成编辑器、Agent 与生产状态；
- `neumorphic-3d-tools.css`：资产与环境工具的工作区外壳；WebGL 画面保留自身场景颜色。

## 物理约束

所有实体共享一个固定在左上方的光源：亮影只能向左上偏移，暗影只能向右下偏移。默认可操作控件凸起；悬停时遮光增强，因此外阴影缩小；按下或选中时切换为内阴影。输入通道默认内凹，聚焦时内阴影减弱，表示通道被打开。

禁止为了反馈给按钮添加 `translate` 或弹跳。机械部件的真实位移仍然允许，例如滑块拇指、开关拇指、拖拽对象以及用于定位的几何变换。

## 新组件接入

优先复用现有语义 Token：

```css
.my-editor {
  color: var(--text-primary);
  background: var(--canvas);
}
```

确实需要显式材质时使用：

```html
<section data-neu="raised">...</section>
<div data-neu="inset">...</div>
<button type="button">执行</button>
```

可用的 `data-neu` 值为 `raised`、`raised-subtle`、`inset`、`pressed` 和 `flat`。不要在卡片内部再次套用大尺寸凸起阴影；密集数据行应保持平面或使用极浅内阴影。

## 可访问性

正文使用满足浅灰背景可读性的深灰色，强调文本使用 `--neu-accent-ink`。所有键盘焦点保留 2px 可见轮廓；`prefers-reduced-motion` 和 `forced-colors` 均有降级规则。状态不能只靠颜色表达，现有 LIVE、MOCK、PLANNED、BLOCKED 文本仍应保留。
