import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Chat from './Chat';

function mockFetchOnce(jsonBody, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    status,
    headers: { get: () => 'application/json' },
    json: async () => jsonBody
  });
}

function sendUserMessage(text) {
  const textarea = screen.getByPlaceholderText(/ask something, or: plan:/i);
  fireEvent.change(textarea, { target: { value: text } });
  const sendButton = screen.getByRole('button', { name: /send/i });
  fireEvent.click(sendButton);
}

function chatLogText() {
  return document.querySelector('.chat-log').textContent;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('generation_refused with full diagnostic detail displays reason, regressions, undeclared deps, invalid versions, and test output', async () => {
  mockFetchOnce({
    success: true,
    action: 'generation_refused',
    reason: 'This change appears to silently remove or weaken an existing route.',
    regressionWarnings: ["Route POST '/register' had 2 argument(s) before and now has only 1."],
    undeclaredDependencies: ['bcrypt'],
    packageVersionCheck: { invalidVersions: [{ name: 'firebase-admin', exactVersion: '9.20.0' }] },
    testCheck: { hasTests: true, passed: false, output: 'AssertionError: expected 5 to equal 3' }
  });

  render(<Chat />);
  sendUserMessage('edit: backend/controllers/UserController.js | add rate limiting');

  await waitFor(() => {
    expect(chatLogText()).toContain('silently remove or weaken an existing route');
  });

  const log = chatLogText();
  expect(log).toContain('Possible regressions:');
  expect(log).toContain("/register");
  expect(log).toContain('Undeclared dependencies:');
  expect(log).toContain('bcrypt');
  expect(log).toContain('Invalid package versions:');
  expect(log).toContain('firebase-admin@9.20.0');
  expect(log).toContain('Test output:');
  expect(log).toContain('AssertionError: expected 5 to equal 3');
});

test('generation_refused with only a reason (no other diagnostic fields) renders just the reason, without crashing', async () => {
  mockFetchOnce({
    success: true,
    action: 'generation_refused',
    reason: 'Some other refusal reason with no extra detail.'
  });

  render(<Chat />);
  sendUserMessage('edit: some/file.js | do something');

  await waitFor(() => {
    expect(chatLogText()).toContain('Some other refusal reason with no extra detail.');
  });

  const log = chatLogText();
  expect(log).not.toContain('Possible regressions:');
  expect(log).not.toContain('Undeclared dependencies:');
  expect(log).not.toContain('Invalid package versions:');
  expect(log).not.toContain('Test output:');
});

test('test_generation_refused (pre-existing action type) still renders correctly', async () => {
  mockFetchOnce({
    success: true,
    action: 'test_generation_refused',
    message: 'The generated test file does not actually pass against the real source file.'
  });

  render(<Chat />);
  sendUserMessage('write tests: backend/controllers/NoteController.js');

  await waitFor(() => {
    expect(chatLogText()).toContain('does not actually pass against the real source file');
  });
});

test('propose_write shows a passing-tests indicator when testCheck.passed is true', async () => {
  mockFetchOnce({
    success: true,
    action: 'propose_write',
    mode: 'edit',
    targetPath: 'backend/controllers/UserController.js',
    before: 'old content',
    after: 'new content',
    testCheck: { hasTests: true, passed: true }
  });

  render(<Chat />);
  sendUserMessage('edit: backend/controllers/UserController.js | add a comment');

  await waitFor(() => {
    expect(screen.getByText(/existing tests pass against this change/i)).toBeInTheDocument();
  });
});

test('propose_write shows a failing-tests warning when testCheck.passed is false', async () => {
  mockFetchOnce({
    success: true,
    action: 'propose_write',
    mode: 'edit',
    targetPath: 'backend/controllers/UserController.js',
    before: 'old content',
    after: 'new content',
    testCheck: { hasTests: true, passed: false, output: 'test failure output' }
  });

  render(<Chat />);
  sendUserMessage('edit: backend/controllers/UserController.js | add a comment');

  await waitFor(() => {
    expect(screen.getByText(/existing tests fail against this change/i)).toBeInTheDocument();
  });
});

test('propose_write shows a no-tests warning when testCheck.hasTests is false', async () => {
  mockFetchOnce({
    success: true,
    action: 'propose_write',
    mode: 'write',
    targetPath: 'backend/newFile.js',
    before: '',
    after: 'new content',
    testCheck: { hasTests: false, skippedReason: 'No test file exists for this source file.' }
  });

  render(<Chat />);
  sendUserMessage('write to: backend/newFile.js | create a helper');

  await waitFor(() => {
    expect(screen.getByText(/no test file found for this source file/i)).toBeInTheDocument();
  });
});
