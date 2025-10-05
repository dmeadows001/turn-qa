// components/ChromeDark.js
import { ui } from '../lib/theme';
import UserMenu from './UserMenu';

export default function ChromeDark({ title = 'TurnQA', children, max = 1040 }) {
  return (
    <div style={ui.page}>
      <main style={ui.wrap(max)}>
        <header
          style={{
            ...ui.header,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={ui.title}>{title}</div>
          <UserMenu />
        </header>
        {children}
      </main>
    </div>
  );
}
