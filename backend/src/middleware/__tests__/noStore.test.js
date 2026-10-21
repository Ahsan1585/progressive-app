const noStore = require('../noStore');

describe('noStore middleware', () => {
  test('marks the response as uncacheable and continues the chain', () => {
    const res = { setHeader: jest.fn() };
    const next = jest.fn();

    noStore({}, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
