import React, {useState} from 'react';
import {render, screen, fireEvent, waitFor, cleanup} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Modal} from '../ui/Modal';

afterEach(cleanup);

describe('shared application dialog', () => {
  it('closes with Escape and returns focus to the opening control', async () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open form</button>
        {open && <Modal label="Example form" onClose={() => setOpen(false)}>
          <label>Name<input /></label>
        </Modal>}</>;
    }
    render(<Example />);
    const opener = screen.getByRole('button', {name: 'Open form'});
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', {name: 'Example form'});
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(dialog, {key: 'Escape'});
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('keeps a pending form open when Escape or the close button is used', async () => {
    const close = vi.fn();
    render(<Modal label="Saving form" onClose={close} dismissible={false}>
      <p>Saving changes…</p>
    </Modal>);
    const dialog = screen.getByRole('dialog', {name: 'Saving form'});
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(screen.getByRole('button', {name: 'Close dialog'})).toBeDisabled();
    fireEvent.keyDown(dialog, {key: 'Escape'});
    fireEvent.click(screen.getByRole('button', {name: 'Close dialog'}));
    expect(close).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
  });
});
