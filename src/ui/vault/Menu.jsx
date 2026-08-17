import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './primitives.jsx';

/**
 * An accessible dropdown menu.
 *
 * Keyboard operation is the point: arrow keys move, Home and End jump,
 * Escape closes and returns focus to the trigger. A menu that can only be
 * driven with a mouse is a menu half the actions are unreachable from.
 */
export function Menu({ label, items, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);
  const restoreFocus = useRef(false);

  const enabled = items.filter((item) => item.type !== 'separator');

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function handlePointer(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    // Capture phase: a page or panel that stops propagation on mousedown
    // would otherwise leave the menu stuck open.
    document.addEventListener('mousedown', handlePointer, true);
    return () => document.removeEventListener('mousedown', handlePointer, true);
  }, [open]);

  // Focus returns to the trigger after the close has rendered. Doing it
  // inside the handler races the re-render: the focused item is removed
  // from the DOM afterwards, which drops focus to the body.
  useEffect(() => {
    if (!open && restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      itemRefs.current[active]?.focus();
    }
  }, [open, active]);

  function close({ returnFocus = true } = {}) {
    restoreFocus.current = returnFocus;
    setOpen(false);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + delta + enabled.length) % enabled.length);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActive(enabled.length - 1);
    }
  }

  async function run(item) {
    // Checked here as well as on the element. The DOM `disabled` attribute
    // stops a real click, but not a synthetic dispatch, and not a state
    // change between render and activation.
    if (item.disabled === true) {
      return;
    }
    // Closed before running: an action that navigates or opens a dialog
    // otherwise leaves the menu hanging over it.
    close({ returnFocus: false });
    await item.onSelect();
  }

  let index = -1;

  return (
    <div ref={containerRef} className="relative">
      {/* A plain button rather than IconButton: Preact does not forward a
          ref through a function component, and the trigger needs one so
          Escape can return focus to it. */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActive(0);
          setOpen((current) => !current);
        }}
        className={[
          'grid size-9 shrink-0 place-items-center rounded-[var(--radius-field)]',
          'transition-colors duration-[var(--dur-150)] active:translate-y-px',
          open
            ? 'bg-[var(--color-surface-hover)] text-[var(--color-fg)]'
            : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)]',
        ].join(' ')}
      >
        <Icon.More />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={handleKeyDown}
          className={[
            'absolute top-full z-30 mt-1 min-w-[220px] py-1',
            align === 'right' ? 'right-0' : 'left-0',
            'rounded-[var(--radius-card)] border border-[var(--color-border)]',
            'bg-[var(--color-panel)] shadow-xl',
          ].join(' ')}
        >
          {items.map((item, position) => {
            if (item.type === 'separator') {
              return (
                <div
                  key={`sep-${position}`}
                  role="separator"
                  className="my-1 h-px bg-[var(--color-border)]"
                />
              );
            }

            index += 1;
            const itemIndex = index;
            const IconComponent = item.icon;

            return (
              <button
                key={item.label}
                ref={(element) => {
                  itemRefs.current[itemIndex] = element;
                }}
                type="button"
                role="menuitem"
                tabIndex={itemIndex === active ? 0 : -1}
                disabled={item.disabled === true}
                onClick={() => run(item)}
                onMouseEnter={() => setActive(itemIndex)}
                className={[
                  'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
                  'transition-colors duration-[var(--dur-100)]',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                  item.tone === 'danger'
                    ? 'text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10'
                    : 'text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]',
                  itemIndex === active && item.disabled !== true
                    ? item.tone === 'danger'
                      ? 'bg-[var(--color-danger)]/10'
                      : 'bg-[var(--color-surface-hover)]'
                    : '',
                ].join(' ')}
              >
                {IconComponent !== undefined && (
                  <IconComponent className="size-4 shrink-0 opacity-70" />
                )}
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint !== undefined && (
                  <span className="shrink-0 text-xs text-[var(--color-fg-subtle)]">
                    {item.hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
