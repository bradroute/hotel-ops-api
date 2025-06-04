// hotel-ops-api/src/routes/__tests__/smsRoutes.test.js

/**
 * Integration tests for the /sms routes.
 * We’ll mock supabaseService so that our route handlers can run without connecting
 * to a real database.
 */

const request = require("supertest");

describe("GET /sms", () => {
  let app;

  beforeAll(() => {
    // 1) Reset modules to ensure our mocks are applied
    jest.resetModules();

    // 2) Mock out the entire supabaseService module before requiring the app.
    //    sms.js calls functions like getAllRequests(), so we stub those here.
    jest.doMock("../../services/supabaseService", () => ({
      getAllRequests: async () => [
        {
          id: "fake-id-1",
          from: "+15551234567",
          message: "Test message",
          department: "housekeeping",
          priority: "normal",
          created_at: "2025-06-05T10:00:00.000Z",
          acknowledged: false,
          completed: false,
        },
        {
          id: "fake-id-2",
          from: "+15559876543",
          message: "Another test",
          department: "maintenance",
          priority: "urgent",
          created_at: "2025-06-05T10:05:00.000Z",
          acknowledged: true,
          completed: false,
        },
      ],
      // Even though GET /sms only uses getAllRequests, we stub the others as no-ops
      insertRequest: async () => {},
      findByTelnyxId: async () => {},
      acknowledgeRequestById: async () => {},
      completeRequestById: async () => {},
      getAnalyticsSummary: async () => {},
      getAnalyticsByDepartment: async () => {},
      getAnalyticsAvgResponseTime: async () => {},
      getAnalyticsDailyResponseTimes: async () => {},
    }));

    // 3) Now require the Express app. Because we mocked supabaseService above,
    //    any code in sms.js that does `const { getAllRequests } = require('../services/supabaseService')`
    //    will receive our fake implementation.
    app = require("../../app");
  });

  afterAll(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("returns JSON array of requests with status 200", async () => {
    await request(app)
      .get("/sms")
      .expect("Content-Type", /json/)
      .expect(200)
      .then((response) => {
        const body = response.body;
        expect(Array.isArray(body)).toBe(true);
        // We stubbed two fake rows above
        expect(body.length).toBe(2);

        // Check shape of first item
        expect(body[0]).toEqual(
          expect.objectContaining({
            id: "fake-id-1",
            from: "+15551234567",
            message: "Test message",
            department: "housekeeping",
            priority: "normal",
            acknowledged: false,
            completed: false,
          })
        );

        // Check shape of second item
        expect(body[1]).toEqual(
          expect.objectContaining({
            id: "fake-id-2",
            from: "+15559876543",
            message: "Another test",
            department: "maintenance",
            priority: "urgent",
            acknowledged: true,
            completed: false,
          })
        );
      });
  });
});
