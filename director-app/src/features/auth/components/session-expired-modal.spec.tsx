import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SessionExpiredModal } from './session-expired-modal';

jest.setTimeout(20000);

describe('SessionExpiredModal', () => {
  it('renders title and message when visible=true', async () => {
    const { getByText } = await render(
      <SessionExpiredModal visible={true} onSignInAgain={() => {}} />,
    );
    expect(getByText('Session Expired')).toBeTruthy();
    expect(getByText(/session has expired/i)).toBeTruthy();
  });

  it('calls onSignInAgain when CTA is pressed', async () => {
    const onSignInAgain = jest.fn();
    const { getByText } = await render(
      <SessionExpiredModal visible={true} onSignInAgain={onSignInAgain} />,
    );
    fireEvent.press(getByText('Sign In Again'));
    expect(onSignInAgain).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when visible=false', async () => {
    const { queryByText } = await render(
      <SessionExpiredModal visible={false} onSignInAgain={() => {}} />,
    );
    expect(queryByText('Session Expired')).toBeNull();
  });
});
