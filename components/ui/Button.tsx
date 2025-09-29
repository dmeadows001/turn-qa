import { ButtonHTMLAttributes } from 'react';

export default function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`btn ${className}`} {...props} />;
}

export function PrimaryButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`btn btn-primary ${className}`} {...props} />;
}
