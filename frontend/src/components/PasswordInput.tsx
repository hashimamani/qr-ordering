import { useId, useState, type InputHTMLAttributes } from 'react';
import { EyeIcon, EyeOffIcon } from './icons';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /**
   * 'current' for signing in, 'new' when setting or changing one. Drives
   * the autoComplete hint so a password manager offers the right thing --
   * without it, browsers tend to autofill the saved login password into
   * "set a new password" fields.
   */
  autoCompleteMode?: 'current' | 'new' | 'off';
};

/**
 * A password field with a reveal toggle, so someone can check what they
 * typed before committing to it -- these are often passwords an admin is
 * creating on someone else's behalf and then reading out to them.
 *
 * Starts masked, always: revealing has to be a deliberate act, since
 * these get typed on tills and tablets in view of a dining room.
 */
export function PasswordInput({ autoCompleteMode = 'current', ...inputProps }: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);
  const hintId = useId();

  const autoComplete =
    autoCompleteMode === 'off'
      ? 'off'
      : autoCompleteMode === 'new'
        ? 'new-password'
        : 'current-password';

  return (
    <div className="password-field">
      <input
        {...inputProps}
        type={revealed ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-describedby={hintId}
      />
      <button
        type="button"
        className="password-reveal"
        onClick={() => setRevealed((v) => !v)}
        // The label states the action, not the state -- a screen reader
        // user needs to know what pressing it will do.
        aria-label={revealed ? 'Hide password' : 'Show password'}
        aria-pressed={revealed}
        // Skipped in tab order: it sits between the password field and the
        // submit button, and stopping there on the way to submitting is
        // friction for the common case. Still reachable by click, and by
        // screen readers navigating by control.
        tabIndex={-1}
        title={revealed ? 'Hide password' : 'Show password'}
      >
        {revealed ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
      </button>
      <span id={hintId} className="visually-hidden">
        {revealed ? 'Password is visible' : 'Password is hidden'}
      </span>
    </div>
  );
}
