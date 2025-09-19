// components/ChromeDark.js
import { ui } from '../lib/theme';

export default function ChromeDark({ title = 'TurnQA', children, max = 1040 }) {
  return (
    <div style={ui.page}>
      <main style={ui.wrap(max)}>
        <header style={ui.header}>
          <div style={ui.title}>{title}</div>
        </header>
        {children}
      </main>
    </div>
  );
}
