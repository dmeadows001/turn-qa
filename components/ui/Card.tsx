import { ReactNode } from 'react';

export default function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`} style={{ padding: 24 }}>{children}</div>;
}
