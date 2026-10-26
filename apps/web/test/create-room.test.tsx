/**
 * Create-room screen.
 *
 * The central assertion: when paid hosting is disabled the UI shows NO
 * payment affordance at all — no fee line, no pay button, not even a disabled
 * one. A greyed-out "Confirm and Pay" still implies money is coming, which is
 * exactly what must not be implied before approval exists.
 */

import type { PublicConfig } from '@ludolite/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CreateRoom } from '../src/screens/CreateRoom.js';

const DISABLED: PublicConfig = {
  paidHostingEnabled: false,
  paymentsAreTestMode: false,
  hostingFeePaise: 100,
  currency: 'INR',
  refundWindowMinutes: 60,
  paidHostingBlockers: ['PAID_ROOM_HOSTING_ENABLED is false'],
};

const ENABLED: PublicConfig = {
  paidHostingEnabled: true,
  paymentsAreTestMode: false,
  hostingFeePaise: 100,
  currency: 'INR',
  refundWindowMinutes: 60,
  paidHostingBlockers: [],
};

const TEST_MODE: PublicConfig = { ...ENABLED, paymentsAreTestMode: true };

function renderScreen(config: PublicConfig, onCreate = vi.fn()) {
  render(
    <CreateRoom
      config={config}
      busy={false}
      error={null}
      onBack={() => {}}
      initialName="Test Player"
      onCreate={onCreate}
    />,
  );
  return { onCreate };
}

describe('when paid hosting is disabled', () => {
  it('shows the free-matches message', () => {
    renderScreen(DISABLED);
    expect(
      screen.getByText(/free private matches are available while paid hosting is being prepared/i),
    ).toBeInTheDocument();
  });

  it('shows no payment button at all, not even disabled', () => {
    renderScreen(DISABLED);

    expect(screen.queryByRole('button', { name: /confirm and pay/i })).toBeNull();
    expect(screen.queryByText(/confirm and pay/i)).toBeNull();
    expect(screen.getByRole('button', { name: /create free room/i })).toBeInTheDocument();
  });

  it('shows no rupee amount anywhere', () => {
    const { container } = render(
      <CreateRoom
        config={DISABLED}
        busy={false}
        error={null}
        onBack={() => {}}
        initialName="Test Player"
        onCreate={vi.fn()}
      />,
    );
    // No price, no fee row, nothing that reads as a charge.
    expect(container.textContent).not.toMatch(/₹\s*1/);
    // Both the hosting fee and the joining fee read FREE.
    expect(screen.getAllByText(/^FREE$/i, { selector: '.v' })).toHaveLength(2);
  });

  it('has no consent checkbox, because nothing is being agreed to', () => {
    renderScreen(DISABLED);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('requests a free room', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderScreen(DISABLED);

    await user.clear(screen.getByLabelText(/your name/i));
    await user.type(screen.getByLabelText(/your name/i), 'Jasmin');
    await user.click(screen.getByRole('button', { name: /create free room/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ funding: 'free', displayName: 'Jasmin' }),
    );
    // No consent payload, because no fee was shown.
    expect(onCreate.mock.calls[0]![0]).not.toHaveProperty('feeConsent');
  });
});

describe('when paid hosting is enabled', () => {
  it('discloses the fee, who pays, and the refund terms', () => {
    renderScreen(ENABLED);

    expect(screen.getByText(/hosting fee — you pay once/i)).toBeInTheDocument();
    expect(screen.getByText(/total charged today/i)).toBeInTheDocument();
    expect(screen.getByText(/not a stake, entry pool, or deposit/i)).toBeInTheDocument();
    expect(screen.getByText(/there is no prize money/i)).toBeInTheDocument();
    expect(screen.getByText(/never charged twice/i)).toBeInTheDocument();
    expect(screen.getByText(/full refund/i)).toBeInTheDocument();
  });

  it('states that friends pay nothing', () => {
    renderScreen(ENABLED);
    expect(screen.getByText(/your 3 friends pay/i)).toBeInTheDocument();
    expect(screen.getAllByText('₹0.00').length).toBeGreaterThan(0);
  });

  it('blocks the pay button until consent is ticked', async () => {
    const user = userEvent.setup();
    renderScreen(ENABLED);

    await user.clear(screen.getByLabelText(/your name/i));
    await user.type(screen.getByLabelText(/your name/i), 'Jasmin');

    const pay = screen.getByRole('button', { name: /confirm and pay/i });
    expect(pay).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    expect(pay).toBeEnabled();
  });

  it('starts with consent unticked', () => {
    renderScreen(ENABLED);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('sends the consent and the amount that was displayed', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderScreen(ENABLED);

    await user.clear(screen.getByLabelText(/your name/i));
    await user.type(screen.getByLabelText(/your name/i), 'Jasmin');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /confirm and pay/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        funding: 'paid',
        feeConsent: {
          acceptedTerms: true,
          acknowledgedNoPrize: true,
          // The server rejects a mismatch, so the client must send what it showed.
          displayedAmountPaise: 100,
        },
      }),
    );
  });
});

describe('sandbox payments', () => {
  it('are labelled unmistakably as test mode', () => {
    renderScreen(TEST_MODE);
    expect(screen.getByText(/test mode — no real money/i)).toBeInTheDocument();
  });

  it('carry no test banner when payments are real', () => {
    renderScreen(ENABLED);
    expect(screen.queryByText(/test mode/i)).toBeNull();
  });
});

describe('seat selection', () => {
  it('defaults to four players and can switch to two', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderScreen(DISABLED);

    expect(screen.getByRole('radio', { name: /4/ })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: /2/ }));
    await user.clear(screen.getByLabelText(/your name/i));
    await user.type(screen.getByLabelText(/your name/i), 'Jasmin');
    await user.click(screen.getByRole('button', { name: /create free room/i }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ seatCount: 2 }));
  });
});
