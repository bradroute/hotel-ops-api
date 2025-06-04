// hotel-ops-api/src/services/__tests__/supabaseService.test.js

describe('supabaseService.getAllRequests', () => {
  afterEach(() => {
    // Clear out Jest's module registry and any mocks
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('resolves to an array of requests when Supabase returns data', async () => {
    // 1) Reset modules to start clean
    jest.resetModules();

    // 2) Provide a mock implementation for '@supabase/supabase-js'
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => ({
          select: () => ({
            order: () =>
              // Return a real Promise that resolves to { data: [...], error: null }
              Promise.resolve({
                data: [
                  {
                    id: 'test-id-123',
                    from: '+15551234567',
                    message: 'Test message body',
                    department: 'maintenance',
                    priority: 'normal',
                    created_at: new Date().toISOString(),
                    acknowledged: false,
                    completed: false,
                  },
                ],
                error: null,
              }),
          }),
        }),
      }),
    }));

    // 3) Now require our service; it will pick up the above mock
    const { getAllRequests } = require('../supabaseService');

    // 4) Call and assert that we get back our stubbed array
    const data = await getAllRequests();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0]).toMatchObject({
      id: 'test-id-123',
      from: '+15551234567',
      message: 'Test message body',
      department: 'maintenance',
      priority: 'normal',
    });
  });

  it('throws an error if Supabase returns an error', async () => {
    // 1) Reset modules to start fresh
    jest.resetModules();

    // 2) Provide a mock implementation for '@supabase/supabase-js' that simulates an error
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => ({
          select: () => ({
            order: () =>
              // Return a Promise that resolves to { data: null, error: { message } }
              Promise.resolve({
                data: null,
                error: { message: 'DB error occurred' },
              }),
          }),
        }),
      }),
    }));

    // 3) Require the service under test; it will use the above mock
    const { getAllRequests } = require('../supabaseService');

    // 4) Assert that getAllRequests() rejects with the “DB error occurred” message
    await expect(getAllRequests()).rejects.toThrow('DB error occurred');
  });
});
