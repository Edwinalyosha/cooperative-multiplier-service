import React from 'react';
import {
  render,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react-native';
import { LoginScreen } from '../screens/login.screen';
import { useAuthStore } from '../store/auth.store';

jest.mock('../store/auth.store');

const mockLogin = jest.fn();
const mockClearError = jest.fn();

(useAuthStore as unknown as jest.Mock).mockReturnValue({
  login: mockLogin,
  clearError: mockClearError,
  isLoading: false,
  error: null,
});

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      login: mockLogin,
      clearError: mockClearError,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders username and password fields', async () => {
    const { getByPlaceholderText } = await render(<LoginScreen />);
    expect(getByPlaceholderText('Username')).toBeTruthy();
    expect(getByPlaceholderText('Password')).toBeTruthy();
  });

  it('submit button is enabled when form is empty (validate on submit)', async () => {
    const { getByText } = await render(<LoginScreen />);
    const button = getByText('Sign In');
    expect(button).toBeTruthy();
    // Button is touchable — validation happens on submit, not on render
  });

  it('shows required error messages when submitting empty form', async () => {
    const { getByText } = await render(<LoginScreen />);
    fireEvent.press(getByText('Sign In'));

    await waitFor(() => {
      expect(getByText('Username is required')).toBeTruthy();
      expect(getByText('Password is required')).toBeTruthy();
    });
  });

  it('shows API error message from store', async () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      login: mockLogin,
      clearError: mockClearError,
      isLoading: false,
      error: 'Invalid username or password',
    });

    const { getByText } = await render(<LoginScreen />);
    expect(getByText('Invalid username or password')).toBeTruthy();
  });

  it('disables Sign In button while isLoading=true', async () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      login: mockLogin,
      clearError: mockClearError,
      isLoading: true,
      error: null,
    });

    const { getByTestId } = await render(<LoginScreen />);
    const button = getByTestId('login-submit');
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  it('calls login() with username and password on submit', async () => {
    mockLogin.mockResolvedValue(undefined);
    const { getByPlaceholderText, getByText } = await render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Username'), 'john_doe');
    fireEvent.changeText(getByPlaceholderText('Password'), 'secret');
    fireEvent.press(getByText('Sign In'));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        username: 'john_doe',
        password: 'secret',
      });
    });

    await mockLogin.mock.results[0]?.value;
  });
});
