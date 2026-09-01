export const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export const focusFirstDrawerElement = (drawer: HTMLElement | null) => {
  const first = [...(drawer?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
    .find((element) => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'));
  first?.focus();
};
