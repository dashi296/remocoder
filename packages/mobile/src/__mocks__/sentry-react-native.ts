const Sentry = {
  init: jest.fn(),
  wrap: jest.fn((component: unknown) => component),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}

export default Sentry
export const { init, wrap, captureException, captureMessage } = Sentry
