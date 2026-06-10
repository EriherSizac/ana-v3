// File: Código de N dígitos en cajas separadas. Auto-avanza, soporta pegar, y dispara
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { useRef, useState, type KeyboardEvent, type ClipboardEvent } from 'react';

/**
 * Código de N dígitos en cajas separadas. Auto-avanza, soporta pegar, y dispara
 * onComplete cuando todas están llenas (para auto-submit).
 */
export function OtpInput({
  length = 6,
  onComplete,
  disabled,
}: {
  length?: number;
  onComplete: (code: string) => void;
  disabled?: boolean;
}) {
  const [vals, setVals] = useState<string[]>(Array(length).fill(''));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function set(i: number, v: string) {
    const digit = v.replace(/\D/g, '').slice(-1);
    const next = [...vals];
    next[i] = digit;
    setVals(next);
    if (digit && i < length - 1) refs.current[i + 1]?.focus();
    if (next.every((d) => d !== '')) onComplete(next.join(''));
  }

  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !vals[i] && i > 0) refs.current[i - 1]?.focus();
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!digits) return;
    const next = Array(length).fill('');
    for (let i = 0; i < digits.length; i++) next[i] = digits[i];
    setVals(next);
    refs.current[Math.min(digits.length, length - 1)]?.focus();
    if (digits.length === length) onComplete(digits);
  }

  return (
    <div className="mt-1 flex gap-2">
      {vals.map((v, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={v}
          disabled={disabled}
          autoFocus={i === 0}
          onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={onPaste}
          className="h-12 w-full rounded-xl border border-neutral-50 text-center text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-secondary disabled:opacity-50"
        />
      ))}
    </div>
  );
}
