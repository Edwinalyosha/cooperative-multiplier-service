import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { PasswordInput } from './password-input';

describe('PasswordInput', () => {
  it('renders with secureTextEntry enabled by default', async () => {
    const { getByTestId } = await render(
      <PasswordInput testID="pw" value="" onChangeText={() => {}} />,
    );
    const input = getByTestId('pw');
    expect(input.props.secureTextEntry).toBe(true);
  });

  it('toggles secureTextEntry when eye icon is pressed', async () => {
    const { getByTestId } = await render(
      <PasswordInput testID="pw" value="" onChangeText={() => {}} />,
    );
    const toggle = getByTestId('pw-toggle');
    await act(async () => {
      fireEvent.press(toggle);
    });
    const input = getByTestId('pw');
    expect(input.props.secureTextEntry).toBe(false);
  });

  it('calls onChangeText when user types', async () => {
    const onChangeText = jest.fn();
    const { getByTestId } = await render(
      <PasswordInput testID="pw" value="" onChangeText={onChangeText} />,
    );
    fireEvent.changeText(getByTestId('pw'), 'newpassword');
    expect(onChangeText).toHaveBeenCalledWith('newpassword');
  });
});
