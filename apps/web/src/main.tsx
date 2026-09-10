import React from 'react';
import { createRoot } from 'react-dom/client';
import { ShellWorkbench } from './app/ShellWorkbench';
import { NeumorphicInteractionHost } from './interactions/NeumorphicInteractionHost';
import './styles/neumorphic-theme.css';
import './interactions/neumorphic-interactions.css';

createRoot(document.getElementById('root')!).render(
  <NeumorphicInteractionHost>
    <ShellWorkbench unified />
  </NeumorphicInteractionHost>,
);
