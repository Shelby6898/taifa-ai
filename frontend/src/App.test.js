import { render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  localStorage.clear();
});

test('renders the login form when no auth token is stored', () => {
  render(<App />);

  expect(screen.getByText(/username/i)).toBeInTheDocument();
  expect(screen.getByText(/password/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /run login/i })).toBeInTheDocument();
  expect(screen.getByText(/no account\? register/i)).toBeInTheDocument();
});

test('renders the chat interface when an auth token is already stored', () => {
  localStorage.setItem('taifa_token', 'fake-token-for-test');

  render(<App />);

  expect(screen.getByPlaceholderText(/ask something, or: plan:/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument();
});
