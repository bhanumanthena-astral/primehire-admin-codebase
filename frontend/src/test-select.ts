import {fireEvent, screen, waitFor} from '@testing-library/react';

/** Exercise the visible dropdown rather than mutating a native select. */
export async function chooseSelect(trigger: HTMLElement, value: string) {
  await waitFor(() => {if (trigger.hasAttribute('disabled')) throw new Error('Dropdown is still loading');});
  fireEvent.click(trigger);
  const option = await waitFor(() => {
    const found = screen.getAllByRole('option').find(item => item.getAttribute('data-value') === value);
    if (!found) throw new Error(`Dropdown option ${value} is unavailable`);
    return found;
  });
  fireEvent.pointerDown(option, {pointerType: 'mouse'});
  fireEvent.click(option);
}
